begin;
-- Keep historical practice conversations while giving current requests an unambiguous route.
alter table public.icash_text_threads add column retired_at timestamptz;
alter table public.icash_text_threads add constraint icash_retired_thread_stopped check(retired_at is null or paused);
alter table public.icash_text_threads drop constraint icash_text_threads_sender_recipient_key;
create unique index icash_text_threads_active_number on public.icash_text_threads(sender,recipient) where retired_at is null;

create or replace function public.icash_retire_expired_practice_threads(p_account uuid,p_sender text,p_phone text)
returns void language plpgsql set search_path='' as $function$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_phone,74));
 -- Retire only expired, stopped PRACTICE threads for this same account/number.
 -- Their messages and original property remain intact; real conversations are never moved.
 update public.icash_text_threads old set retired_at=now()
 where old.sender=p_sender and old.recipient=p_phone and old.account_id=p_account
  and old.retired_at is null and old.paused and old.permission_until<now()
  and exists(select 1 from public.icash_deal_files previous where previous.id=old.deal_id and previous.account_id=p_account and previous.terms->>'practice'='true')
  and not exists(select 1 from public.icash_text_messages m where m.thread_id=old.id and m.state in ('ready','dispatching','needs_review'));
end $function$;
revoke all on function public.icash_retire_expired_practice_threads(uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_retire_expired_practice_threads(uuid,text,text) to service_role;

do $patch$
declare definition text;needle text:=$old$'raw',l.property->'raw','sellerRequest'$old$;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_assign_seller_lead_for(uuid)';end if;
 execute replace(definition,needle,$new$'raw',l.property->'raw','sellerCostReserveCents',l.property->'sellerCostReserveCents','sellerRequest'$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$where sender=v->>'smsSender' and recipient=p->>'phone'$old$;
begin
 definition:=pg_get_functiondef('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_decide_authority_review(uuid,uuid,text,text,jsonb)';end if;
 execute replace(definition,needle,$new$where retired_at is null and sender=v->>'smsSender' and recipient=p->>'phone'$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$where sender=sender_phone and recipient=p_phone$old$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)';end if;
 execute replace(definition,needle,$new$where retired_at is null and sender=sender_phone and recipient=p_phone$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$where sender=v->>'to' and recipient=v->>'from'$old$;
begin
 definition:=pg_get_functiondef('public.icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_ingest_text_event_before_operational(jsonb,boolean)';end if;
 execute replace(definition,needle,$new$where retired_at is null and sender=v->>'to' and recipient=v->>'from'$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$where th.sender=v_sender and th.recipient=oc.phone$old$;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_project_operational_sms_contacts(uuid)';end if;
 execute replace(definition,needle,$new$where th.retired_at is null and th.sender=v_sender and th.recipient=oc.phone$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$if not found then return false;end if;$old$;
begin
 definition:=pg_get_functiondef('public.icash_sms_thread_review_current(uuid,uuid,boolean)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_sms_thread_review_current(uuid,uuid,boolean)';end if;
 execute replace(definition,needle,$new$if not found or t.retired_at is not null then return false;end if;$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$if not found or not exists$old$;
begin
 definition:=pg_get_functiondef('public.icash_queue_text(uuid,uuid,uuid,text,uuid[])'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_queue_text(uuid,uuid,uuid,text,uuid[])';end if;
 execute replace(definition,needle,$new$if not found or t.retired_at is not null or not exists$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$ insert into public.icash_text_threads(account_id$old$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)';end if;
 execute replace(definition,needle,$new$ perform public.icash_retire_expired_practice_threads(p_account,chosen_sender,l.phone);
 insert into public.icash_text_threads(account_id$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$on conflict(sender,recipient)$old$;
begin
 definition:=pg_get_functiondef('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_decide_authority_review(uuid,uuid,text,text,jsonb)';end if;
 execute replace(definition,needle,$new$on conflict(sender,recipient) where retired_at is null$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$on conflict(sender,recipient)$old$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)';end if;
 execute replace(definition,needle,$new$on conflict(sender,recipient) where retired_at is null$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$on conflict(sender,recipient)$old$;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller routing prerequisite changed: icash_project_operational_sms_contacts(uuid)';end if;
 execute replace(definition,needle,$new$on conflict(sender,recipient) where retired_at is null$new$);
end $patch$;

do $patch$
declare definition text;needle text:=$old$ if exists(select 1 from public.icash_text_threads where retired_at is null and sender=sender_phone$old$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Manual text routing prerequisite changed';end if;
 definition:=replace(definition,needle,$new$ perform public.icash_retire_expired_practice_threads(p_account,sender_phone,p_phone);
 if exists(select 1 from public.icash_text_threads where retired_at is null and sender=sender_phone$new$);
 execute replace(definition,'where account_id=p_account and deal_id=d.id and recipient=p_phone','where retired_at is null and account_id=p_account and deal_id=d.id and recipient=p_phone');
end $patch$;
commit;
