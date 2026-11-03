-- Bound expensive seller-opener eligibility without dropping original guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure))<>'4272d63ce33519aa3542be25726c5c88' then
  raise exception 'Seller opener bounded scan prerequisite changed';
 end if;
end $guard$;
create schema if not exists icash_work_private;
revoke all on schema icash_work_private from public,anon,authenticated;
grant usage on schema icash_work_private to service_role;
create table icash_work_private.seller_opener_scan(
 id integer primary key check(id=1),last_thread_id uuid,updated_at timestamptz not null default clock_timestamp()
);
alter table icash_work_private.seller_opener_scan enable row level security;
revoke all on icash_work_private.seller_opener_scan from public,anon,authenticated,service_role;
grant select on icash_work_private.seller_opener_scan to service_role;
grant update(last_thread_id,updated_at) on icash_work_private.seller_opener_scan to service_role;
insert into icash_work_private.seller_opener_scan(id) values(1);
CREATE OR REPLACE FUNCTION public.icash_next_before_sms_inbound_campaign()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior jsonb;thread public.icash_text_threads;message uuid;ticket public.icash_automation_tickets;cursor_id uuid;scanned uuid;candidate record;
begin
 perform pg_advisory_xact_lock(726341927);
 prior:=public.icash_next_before_seller_openers();
 if prior->>'token' is not null then return prior;end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled) then return prior;end if;
 if exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 second') then return prior;end if;
 select last_thread_id into cursor_id from icash_work_private.seller_opener_scan where id=1;
 if not found then return prior;end if;
 -- Bound the source set before any recipient-hour or full contact proof.
 -- The shared scheduler lock serializes cursor advance and ticket issuance.
 for candidate in
  with candidates as materialized (
 select t.id,t.account_id from public.icash_text_threads t
 join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=t.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 join public.icash_timezone_names zone on zone.name=t.timezone
 where (cursor_id is null or t.id>cursor_id) and t.party='seller' and not t.paused and t.ai_mode='auto'
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 order by t.id limit 32
  ) select * from candidates order by id
 loop
  scanned:=candidate.id;
  select ordered.* into thread from (select t.* from public.icash_text_threads t
 join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=t.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 join public.icash_timezone_names zone on zone.name=t.timezone
 where t.id=candidate.id and t.account_id=candidate.account_id and t.party='seller' and not t.paused and t.ai_mode='auto' and public.icash_sms_thread_dispatch_until(candidate.account_id,candidate.id)>now()
 and public.icash_sms_outreach_window_current(candidate.account_id,candidate.id)
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 order by t.id for update of t skip locked offset 0) ordered
 where public.icash_seller_opener_candidate_body(ordered.account_id,ordered.id) is not null
 limit 1;
  if not found then continue;end if;
  message:=public.icash_queue_seller_opener(thread.account_id,thread.id);
  if message is null then continue;end if;
  insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(thread.account_id,'seller_opener',message) returning * into ticket;
  update icash_work_private.seller_opener_scan set last_thread_id=scanned,updated_at=clock_timestamp() where id=1;
  return jsonb_build_object('token',ticket.token);
 end loop;
 -- An empty upper range resets only the scan cursor. Blocked rows return on
 -- the next sweep; no task, financial hold or customer mode is changed.
 update icash_work_private.seller_opener_scan set last_thread_id=scanned,updated_at=clock_timestamp() where id=1;
 return prior;
end $function$;

commit;
