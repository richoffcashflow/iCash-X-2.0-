begin;
-- Existing seller records stay immutable. Only a service-provisioned test may
-- temporarily share the owner's number pair; normal mixed-role inserts still fail.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_sms_thread_binding()'::regprocedure);
 needle:=$old$ if exists(select 1 from public.icash_text_threads t where t.sender=new.sender and t.recipient=new.recipient and t.retired_at is null and t.deal_id<>new.deal_id) then$old$;
 if position(needle in definition)=0 then raise exception 'SMS binding prerequisite changed';end if;
 definition:=replace(definition,needle,$new$
 if new.party='buyer' and new.seller_intake_id is null and new.operational_contact_id is null and new.sms_review_request_id is null
 and exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=new.id and x.account_id=new.account_id and x.deal_id=new.deal_id
  and x.sender=new.sender and x.phone=new.recipient and x.sms_rate_id=new.sms_rate_id and public.icash_owner_buyer_test_current(x.id)) then return new;end if;
 if exists(select 1 from public.icash_text_threads t where t.sender=new.sender and t.recipient=new.recipient and t.retired_at is null and t.deal_id<>new.deal_id
 and not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id)) then$new$);
 definition:=replace(definition,$old$t.retired_at is null and t.party<>'seller')$old$,$new$t.retired_at is null and t.party<>'seller' and not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id))$new$);
 execute definition;
end $patch$;

-- Legacy resolution ignores test records after the explicit test route expires.
-- The view has no client grants and never changes the underlying seller history.
create view public.icash_non_test_text_threads with (security_invoker=true) as
 select t.* from public.icash_text_threads t where not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id);
revoke all on public.icash_non_test_text_threads from public,anon,authenticated;
grant select on public.icash_non_test_text_threads to service_role;
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('public.icash_sms_resolve_explicit_property(text,text,text)'::regprocedure);
 if position('public.icash_text_threads' in definition)=0 then raise exception 'Explicit SMS resolver prerequisite changed';end if;
 execute replace(definition,'public.icash_text_threads','public.icash_non_test_text_threads');
 definition:=pg_get_functiondef('icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz)'::regprocedure);
 if position('public.icash_text_threads' in definition)=0 then raise exception 'Return-call focus prerequisite changed';end if;
 execute replace(definition,'public.icash_text_threads','public.icash_non_test_text_threads');
end $patch$;

alter function public.icash_sms_resolve_property(text,text,text) rename to icash_sms_resolve_before_owner_buyer_test;
create function public.icash_sms_resolve_property(p_sender text,p_recipient text,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare x public.icash_owner_buyer_tests;last_test timestamptz;chosen uuid;
begin
 select * into x from public.icash_owner_buyer_tests where sender=p_sender and phone=p_recipient order by created_at desc limit 1;
 if found then
  select max(created_at) into last_test from public.icash_text_messages where thread_id=x.thread_id and direction='outgoing'
   and state in ('accepted','delivered') and provider_id is not null;
  if last_test is not null and public.icash_sms_thread_review_current(x.account_id,x.thread_id,false) then return x.thread_id;end if;
  -- After expiry, a reply to the test must not silently become a seller reply.
  -- A later real seller message or an explicit matching street reestablishes it.
  if last_test is not null and not exists(select 1 from public.icash_non_test_text_threads t join public.icash_text_messages m on m.thread_id=t.id
   where t.sender=p_sender and t.recipient=p_recipient and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at>last_test) then
   select t.id into chosen from public.icash_non_test_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where t.sender=p_sender and t.recipient=p_recipient and t.retired_at is null
   and position(' '||public.icash_sms_normalize_address(split_part(d.terms->>'address',',',1))||' ' in ' '||public.icash_sms_normalize_address(p_body)||' ')>0;
   return chosen;
  end if;
 end if;
 return public.icash_sms_resolve_before_owner_buyer_test(p_sender,p_recipient,p_body);
end $$;

alter function icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz) rename to return_call_focus_before_owner_test;
create function icash_recorded_reception_private.return_call_focus(p_account uuid,p_phone text,p_clock timestamptz)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare chosen uuid;
begin
 select x.thread_id into chosen from public.icash_owner_buyer_tests x
 where x.account_id=p_account and x.phone=p_phone and x.created_at<=p_clock and x.expires_at>p_clock
 and public.icash_sms_thread_review_current(x.account_id,x.thread_id,false)
 and exists(select 1 from public.icash_buyer_package_texts p join public.icash_text_messages m on m.id=p.message_id
  where p.thread_id=x.thread_id and m.account_id=x.account_id and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at<=p_clock);
 if chosen is not null then return chosen;end if;
 return icash_recorded_reception_private.return_call_focus_before_owner_test(p_account,p_phone,p_clock);
end $$;

-- Expired test threads never make a normal return call ambiguous.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_reception_context_before_agreement(uuid,text)'::regprocedure);
 needle:=$old$and (focus_thread is null or t.id=focus_thread)$old$;
 if position(needle in definition)=0 then raise exception 'Reception candidate prerequisite changed';end if;
 definition:=replace(definition,needle,needle||$new$ and (t.id=focus_thread or not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id))$new$);
 execute definition;
end $patch$;

alter function icash_recorded_reception_private.contact_first_name(uuid,uuid,text,text) rename to contact_first_name_before_owner_test;
create function icash_recorded_reception_private.contact_first_name(p_account uuid,p_deal uuid,p_party text,p_phone text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare name text;
begin
 if p_party='buyer' then
  select i.first_name into name from public.icash_owner_buyer_tests x join public.icash_customer_identities i on i.account_id=x.account_id
  where x.account_id=p_account and x.deal_id=p_deal and x.phone=p_phone and public.icash_owner_buyer_test_current(x.id);
  if name ~ '^[[:alpha:]''’ -]{1,40}$' then return split_part(btrim(name),' ',1);end if;
 end if;
 return icash_recorded_reception_private.contact_first_name_before_owner_test(p_account,p_deal,p_party,p_phone);
end $$;
revoke all on function public.icash_sms_resolve_property(text,text,text),icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz),
 icash_recorded_reception_private.contact_first_name(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_sms_resolve_property(text,text,text),icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz),
 icash_recorded_reception_private.contact_first_name(uuid,uuid,text,text) to service_role;
commit;
