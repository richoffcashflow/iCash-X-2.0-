-- Use the same bounded text selector in dedicated and legacy scheduler paths.
-- Original final source/copy/send checks and shared one-use locking remain.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_issue_ready_seller_text()'::regprocedure))<>'d4a72acbed7f569b2dc1b65a77b493ce'
  or md5(pg_get_functiondef('public.icash_next_before_unstarted_sms_recovery()'::regprocedure))<>'39b4627da8c915c05894792f40e305f6'
  or md5(pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure))<>'e6f81c009c46713083f8dc882e6b7d1f'
  or not exists(select 1 from icash_work_private.seller_opener_scan where id=1)
 then raise exception 'Bounded seller dispatch prerequisite changed';end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.icash_issue_ready_seller_text()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;m uuid;ticket public.icash_automation_tickets;cursor_id uuid;scanned uuid;candidate record;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_operating_budget where id=1 and enabled) and not exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 second') then
 select last_thread_id into cursor_id from icash_work_private.seller_opener_scan where id=1;
 if not found then return null;end if;
 -- Bound expensive eligibility checks, then revisit skipped rows after wrap.
 for candidate in
 with candidates as materialized (
 select th.id,th.account_id from public.icash_text_threads th join public.icash_accounts a on a.id=th.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true' join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now() join public.icash_timezone_names tz on tz.name=th.timezone
 where not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual) and th.party='seller' and not th.paused and th.ai_mode='auto' and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
 and (not exists(select 1 from public.icash_text_messages where thread_id=th.id) or exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=th.id and i.expires_at>now() and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id)))
 and (cursor_id is null or th.id>cursor_id)
 order by th.id limit 32
 ) select * from candidates order by id
 loop
 scanned:=candidate.id;
 select ordered.* into t from (select th.* from public.icash_text_threads th join public.icash_accounts a on a.id=th.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true' join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now() join public.icash_timezone_names tz on tz.name=th.timezone
 where th.id=candidate.id and th.account_id=candidate.account_id and public.icash_outreach_sms_current(candidate.account_id) and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual) and th.party='seller' and not th.paused and th.ai_mode='auto' and public.icash_sms_thread_dispatch_until(candidate.account_id,candidate.id)>now() and public.icash_sms_outreach_window_current(candidate.account_id,candidate.id) and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
 and (not exists(select 1 from public.icash_text_messages where thread_id=th.id) or exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=th.id and i.expires_at>now() and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id))) order by th.id for update of th skip locked offset 0) ordered
 where public.icash_seller_opener_candidate_body(ordered.account_id,ordered.id) is not null
 or exists(select 1 from public.icash_sms_inbound_invitations i
  join public.icash_text_messages msg on msg.id=i.message_id and msg.thread_id=ordered.id and msg.account_id=ordered.account_id and msg.state='ready'
  where i.thread_id=ordered.id and i.expires_at>now()
   and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id))
 limit 1;
 if found then
  select i.message_id into m from public.icash_sms_inbound_invitations i
   join public.icash_text_messages msg on msg.id=i.message_id and msg.thread_id=t.id and msg.account_id=t.account_id and msg.state='ready'
   where i.thread_id=t.id and i.expires_at>now()
    and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id)
   order by msg.created_at,msg.id limit 1;
  if m is null then m:=public.icash_queue_seller_opener(t.account_id,t.id);end if;
  if m is not null then insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(t.account_id,'seller_opener',m) returning * into ticket;
   update icash_work_private.seller_opener_scan set last_thread_id=scanned,updated_at=clock_timestamp() where id=1;
   return jsonb_build_object('token',ticket.token);end if;
 end if;
 end loop;
 update icash_work_private.seller_opener_scan set last_thread_id=scanned,updated_at=clock_timestamp() where id=1;
 end if;
 return null;
end $function$
;
create or replace function public.icash_next_before_unstarted_sms_recovery()
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare ticket jsonb;
begin
 perform pg_advisory_xact_lock(726341927);
 ticket:=public.icash_issue_ready_seller_text();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_before_sms_inbound_campaign();
end $function$;
commit;
