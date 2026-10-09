begin;
set local lock_timeout='3s';
lock table public.icash_owner_buyer_tests,public.icash_text_threads in access exclusive mode;

-- Keep failed attempts and their immutable sender/message history. A new,
-- explicitly authorized attempt must revoke the previous attempt first.
alter table public.icash_owner_buyer_tests drop constraint icash_owner_buyer_tests_account_id_deal_id_key;
create unique index icash_owner_buyer_test_active_deal
 on public.icash_owner_buyer_tests(account_id,deal_id) where revoked_at is null;
alter table public.icash_owner_buyer_tests add column send_email boolean not null default true;

-- The owner can test both parties for the same property from their own phone.
-- Put explicitly bound test threads in a separate uniqueness scope, without
-- changing any seller thread or weakening normal conversation uniqueness.
alter table public.icash_text_threads add column owner_buyer_test_id uuid
 references public.icash_owner_buyer_tests(id) deferrable initially deferred;
update public.icash_text_threads t set owner_buyer_test_id=x.id
 from public.icash_owner_buyer_tests x where t.id=x.thread_id;
set constraints all immediate;
drop index public.icash_text_threads_active_property_number;
create unique index icash_text_threads_active_property_number
 on public.icash_text_threads(account_id,deal_id,sender,recipient)
 where retired_at is null and owner_buyer_test_id is null;
create unique index icash_text_threads_owner_buyer_test
 on public.icash_text_threads(owner_buyer_test_id) where owner_buyer_test_id is not null;

do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_sms_thread_binding()'::regprocedure);
 needle:='row(new.account_id,new.deal_id,new.sender,new.recipient,new.party,new.seller_intake_id)';
 if position(needle in definition)=0 then raise exception 'Immutable thread binding prerequisite changed';end if;
 definition:=replace(definition,needle,'row(new.account_id,new.deal_id,new.sender,new.recipient,new.party,new.seller_intake_id,new.owner_buyer_test_id)');
 definition:=replace(definition,'row(old.account_id,old.deal_id,old.sender,old.recipient,old.party,old.seller_intake_id)',
  'row(old.account_id,old.deal_id,old.sender,old.recipient,old.party,old.seller_intake_id,old.owner_buyer_test_id)');
 needle:='where x.thread_id=new.id and x.account_id=new.account_id';
 if position(needle in definition)=0 then raise exception 'Owner test binding prerequisite changed';end if;
 definition:=replace(definition,needle,'where x.id=new.owner_buyer_test_id and x.thread_id=new.id and x.account_id=new.account_id');
 needle:='and public.icash_owner_buyer_test_current(x.id)) then return new;end if;';
 if position(needle in definition)=0 then raise exception 'Owner test authorization prerequisite changed';end if;
 definition:=replace(definition,needle,needle||E'\n if new.owner_buyer_test_id is not null then raise exception ''Current exact owner test required'';end if;');
 execute definition;

 definition:=pg_get_functiondef('public.icash_sms_thread_review_current(uuid,uuid,boolean)'::regprocedure);
 needle:='where t.id=x.thread_id and t.account_id=x.account_id';
 if position(needle in definition)=0 then raise exception 'Owner test review prerequisite changed';end if;
 execute replace(definition,needle,'where t.owner_buyer_test_id=x.id and t.id=x.thread_id and t.account_id=x.account_id');
end $patch$;

-- Keep existing provisioners' ON CONFLICT behavior and business-thread reads.
-- These are the same keys and predicates, excluding only owner test records.
do $patch$ declare row record;definition text;needle text:='on conflict(account_id,deal_id,sender,recipient) where retired_at is null';begin
 for row in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and position(needle in p.prosrc)>0
 loop
  definition:=pg_get_functiondef(row.oid);
  definition:=replace(definition,needle,needle||' and owner_buyer_test_id is null');
  definition:=replace(definition,'select * into sms_thread from public.icash_text_threads where retired_at is null',
   'select * into sms_thread from public.icash_text_threads where retired_at is null and owner_buyer_test_id is null');
  execute definition;
 end loop;
 if to_regprocedure('public.icash_property_text_sender(uuid,uuid,text)') is not null then
  definition:=pg_get_functiondef('public.icash_property_text_sender(uuid,uuid,text)'::regprocedure);
  execute replace(definition,'public.icash_text_threads t','public.icash_non_test_text_threads t');
 end if;
end $patch$;

-- An SMS-only re-test must not enqueue another copy of the delivered email.
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('public.icash_deal_email_contacts(uuid,uuid)'::regprocedure);
 execute replace(definition,'x.deal_id=p_deal and public.icash_owner_buyer_test_current(x.id)',
  'x.deal_id=p_deal and x.send_email and public.icash_owner_buyer_test_current(x.id)');
 definition:=pg_get_functiondef('public.icash_claim_deal_email(uuid,uuid)'::regprocedure);
 execute replace(definition,'if not found or not public.icash_owner_buyer_test_current(x.id)',
  'if not found or not x.send_email or not public.icash_owner_buyer_test_current(x.id)');
end $patch$;
commit;
