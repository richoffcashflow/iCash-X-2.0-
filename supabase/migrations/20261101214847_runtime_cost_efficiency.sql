-- Receipt-driven recovery and bounded idle work. No financial or provider replay.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

do $preflight$
begin
 if md5(pg_get_functiondef('icash_work_private.enqueue_account_followup()'::regprocedure))<>'415cef373037b790c2a67645ef48c06a'
  or md5(pg_get_functiondef('public.icash_finish_account_followup(uuid,uuid,boolean)'::regprocedure))<>'66d94797320d706fa020a2c435aad5ed' then
  raise exception 'Account recovery prerequisite changed';
 end if;
end $preflight$;

alter table icash_work_private.account_followups
 add column unchanged_attempts integer not null default 0 check(unchanged_attempts>=0),
 add column failure_attempts integer not null default 0 check(failure_attempts>=0);

create function icash_work_private.wake_account_followup(p_account uuid,p_notify boolean default false) returns void
language sql security invoker set search_path='' as $function$
 insert into icash_work_private.account_followups(account_id,notify_version)
 values(p_account,case when p_notify then 1 else 0 end)
 on conflict(account_id) do update set
  requested_version=icash_work_private.account_followups.requested_version+1,
  notify_version=case when p_notify then icash_work_private.account_followups.requested_version+1
   else icash_work_private.account_followups.notify_version end,
  unchanged_attempts=0,failure_attempts=0,
  next_run_at=least(icash_work_private.account_followups.next_run_at,clock_timestamp()),updated_at=clock_timestamp();
$function$;
revoke all on function icash_work_private.wake_account_followup(uuid,boolean) from public,anon,authenticated;
grant execute on function icash_work_private.wake_account_followup(uuid,boolean) to service_role;

create or replace function icash_work_private.enqueue_account_followup() returns trigger
language plpgsql security invoker set search_path='' as $function$
declare changed boolean;
begin
 if old.state<>'consumed' or new.state not in ('complete','held') or new.kind='account_reconcile' then return new;end if;
 -- These results carry no new primary work. Operation/receipt triggers below
 -- still recover independently when a real financial observation arrives.
 if new.state='complete' and (new.kind in ('customer_updates','customer_attention') or new.outcome in (
  'supply_target_met','updates_disabled','updates_idle','updates_held',
  'attention_disabled','attention_idle','attention_held','waiting_for_daytime_budget',
  'waiting_for_available_credits','seller_inventory_unavailable','waiting_for_active_call',
  'outside_contact_hours','empty','awaiting_conversation','awaiting_counterparty','customer_signature_needed')) then return new;end if;
 changed:=new.state='complete' and new.kind not in ('customer_updates','customer_attention');
 perform icash_work_private.wake_account_followup(new.account_id,changed);
 return new;
end $function$;

create function icash_work_private.wake_on_operation_change() returns trigger
language plpgsql security invoker set search_path='' as $function$
begin
 if tg_op='UPDATE' and (new.state,new.actual_micros,new.charged_cents,new.settlement_evidence)
  is not distinct from (old.state,old.actual_micros,old.charged_cents,old.settlement_evidence) then return new;end if;
 if new.state in ('dispatched','settled') then perform icash_work_private.wake_account_followup(new.account_id,false);end if;
 return new;
end $function$;
-- Fairness timestamps and repeated reads cannot wake themselves.
create trigger icash_followup_operation_change after insert or update of state,actual_micros,charged_cents,settlement_evidence
 on public.icash_operation_spend for each row execute function icash_work_private.wake_on_operation_change();

create function icash_work_private.wake_on_cost_receipt() returns trigger
language plpgsql security invoker set search_path='' as $function$
 declare a uuid;
begin
 if tg_op='UPDATE' and (new.provider,new.event_key,new.source_ref,new.amount,new.units)
  is not distinct from (old.provider,old.event_key,old.source_ref,old.amount,old.units) then return new;end if;
 -- Reset only the receipt-check cursor for this exact operation. A new receipt
 -- must not wait behind the previous five-minute check or unrelated old holds.
 update public.icash_operation_spend set estimate_checked_at=null
  where operation_key in (new.source_ref,new.event_key) and state='dispatched';
 for a in select distinct o.account_id from public.icash_operation_spend o
  where o.operation_key in (new.source_ref,new.event_key) and o.state in ('reserved','dispatched') loop
  perform icash_work_private.wake_account_followup(a,false);
 end loop;
 return new;
end $function$;
create trigger icash_followup_cost_receipt after insert or update of amount,units,source_ref
 on public.icash_cost_observations for each row execute function icash_work_private.wake_on_cost_receipt();

create function icash_work_private.wake_on_conversation_receipt() returns trigger
language plpgsql security invoker set search_path='' as $function$
begin
 if tg_op='UPDATE' and (new.state,new.result,new.completed_at)
  is not distinct from (old.state,old.result,old.completed_at) then return new;end if;
 if new.state='complete' then
  update public.icash_operation_spend set estimate_checked_at=null
   where operation_key=new.operation_key and account_id=new.account_id and state='dispatched';
  perform icash_work_private.wake_account_followup(new.account_id,true);
 end if;
 return new;
end $function$;
create trigger icash_followup_conversation_receipt after insert or update of state,result,completed_at
 on public.icash_live_conversations for each row execute function icash_work_private.wake_on_conversation_receipt();

create or replace function public.icash_finish_account_followup(p_account uuid,p_ticket uuid,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $function$
declare q icash_work_private.account_followups;stamp timestamptz:=clock_timestamp();fresh boolean;delay interval;idle integer;failures integer;
begin
 select * into q from icash_work_private.account_followups where account_id=p_account
  and ticket_id=p_ticket and lease_until>stamp for update;
 if not found then return false;end if;
 update public.icash_automation_tickets set state=case when p_success then 'complete' else 'held' end,
  outcome=case when p_success then 'account_reconciled' else 'reconciliation_retry_due' end,completed_at=stamp
  where id=p_ticket and account_id=p_account and kind='account_reconcile' and state='consumed';
 if not found then return false;end if;
 select exists(select 1 from public.icash_operation_spend o where o.account_id=p_account
  and o.state in ('reserved','dispatched') and coalesce(o.dispatched_at,o.created_at)>stamp-interval '1 day') into fresh;
 idle:=case when q.requested_version>q.claimed_version or q.claimed_version>q.completed_version then 0 else least(q.unchanged_attempts+1,3) end;
 failures:=case when p_success or q.requested_version>q.claimed_version then 0 else least(q.failure_attempts+1,4) end;
 delay:=case
  when q.requested_version>q.claimed_version then interval '0 seconds'
  when not p_success then case failures when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '15 minutes' end
  when fresh then interval '5 minutes'
  when idle=0 then interval '15 minutes'
  when idle=1 then interval '1 hour'
  else interval '6 hours' end;
 update icash_work_private.account_followups set
  completed_version=case when p_success then greatest(completed_version,q.claimed_version) else completed_version end,
  notified_version=case when p_success then greatest(notified_version,q.claimed_notify_version) else notified_version end,
  unchanged_attempts=idle,failure_attempts=failures,next_run_at=stamp+delay,
  ticket_id=null,lease_until=null,claimed_version=null,claimed_notify_version=null,
  last_completed_at=case when p_success then stamp else last_completed_at end,updated_at=stamp where account_id=p_account;
 return true;
end $function$;

-- Read-only preflight before allocating a customer-update handler. Final claim
-- and send authorization retain ownership, provider readiness and idempotency.
create function icash_work_private.customer_update_available(p_account uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $function$
declare p public.icash_customer_update_preferences;chosen text;email_address text;daily_limit integer;
begin
 select global_daily_limit into daily_limit from public.icash_customer_update_settings where id=1 and enabled;
 if not found then return false;end if;
 select x.* into p from public.icash_customer_update_preferences x join public.icash_accounts a
  on a.id=x.account_id and a.owner_user_id=x.owner_user_id where x.account_id=p_account;
 if not found or not(p.email_enabled or p.sms_enabled) or not public.icash_customer_update_consent_valid(p.consent_version) then return false;end if;
 if (select count(*) from public.icash_customer_update_deliveries where created_at>now()-interval '24 hours')>=daily_limit then return false;end if;
 select lower(email) into email_address from auth.users where id=p.owner_user_id and email_confirmed_at is not null;
 for chosen in select unnest(array['email','sms']) loop
  if chosen='email' and (p.email_enabled and p.email_suppressed_at is null and p.consent_email=email_address) is not true then continue;end if;
  if chosen='sms' and (p.sms_enabled and p.phone is not null and extract(hour from now() at time zone p.timezone) between 9 and 19) is not true then continue;end if;
  if chosen='sms' and (exists(select 1 from public.icash_text_suppressions where phone=p.phone)
   or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p.phone)
   or public.icash_webinar_campaign_sender(p.phone) is null) then continue;end if;
  if (select count(*) from public.icash_customer_update_deliveries where account_id=p_account and channel=chosen and created_at>now()-interval '24 hours')>=(case when chosen='sms' then 1 else 2 end)
   or exists(select 1 from public.icash_customer_update_deliveries where account_id=p_account and channel=chosen and created_at>now()-interval '1 hour') then continue;end if;
  if not public.icash_lifecycle_frequency_ok(chosen,case when chosen='email' then email_address else p.phone end) then continue;end if;
  if exists(select 1 from public.icash_customer_update_sources(p_account) x where x.event_at>=p.consented_at
   and not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.source_key=x.source_key)
   and (x.kind<>'credits_low' or not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.kind='credits_low' and n.created_at>now()-interval '24 hours'))
   and (x.kind<>'research_complete' or not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.kind='research_complete' and n.created_at>now()-interval '24 hours'))) then return true;end if;
 end loop;
 return false;
end $function$;
revoke all on function icash_work_private.customer_update_available(uuid),icash_work_private.wake_on_operation_change(),
 icash_work_private.wake_on_cost_receipt(),icash_work_private.wake_on_conversation_receipt() from public,anon,authenticated;
grant execute on function icash_work_private.customer_update_available(uuid) to service_role;

-- Exact installed bodies: preserve the existing selector chain and all guards.
do $patch$
declare d text;needle text;
begin
 if md5(pg_get_functiondef('public.icash_claim_customer_update(uuid,boolean,boolean)'::regprocedure))<>'749cd41f72329490280e359de93d3fc9' then raise exception 'Customer update eligibility changed';end if;
 if md5(pg_get_functiondef('public.icash_next_before_seller_continuation()'::regprocedure))<>'ca1a6a756d32f4cd264c606ef9e6d797' then raise exception 'Customer update selector changed';end if;
 d:=pg_get_functiondef('public.icash_next_before_seller_continuation()'::regprocedure);
 needle:='insert into public.icash_automation_tickets(account_id,kind) values(p.account_id,''customer_updates'')';
 if strpos(d,needle)=0 then raise exception 'Customer update insertion changed';end if;
 execute replace(d,needle,'if not icash_work_private.customer_update_available(p.account_id) then return null;end if;'||chr(10)||'  '||needle);

 -- Keep signing's ten-minute provider poll. An immediate provider webhook is
 -- not established here, so a longer wait could delay a newly signed deal.
end $patch$;
commit;
