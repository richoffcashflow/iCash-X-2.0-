-- Dedicated automation pools and durable account reconciliation.
-- New pools stay disabled until the matching Vercel handler is live.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

create schema if not exists icash_work_private;
revoke all on schema icash_work_private from public,anon,authenticated;
grant usage on schema icash_work_private to service_role;
create table icash_work_private.dispatch_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 updated_at timestamptz not null default now(),last_seed_at timestamptz
);
insert into icash_work_private.dispatch_policy(id) values(1);
alter table icash_work_private.dispatch_policy enable row level security;

create table icash_work_private.account_followups(
 account_id uuid primary key references public.icash_accounts(id),
 requested_version bigint not null default 1,
 completed_version bigint not null default 0,
 notify_version bigint not null default 0,
 notified_version bigint not null default 0,
 claimed_version bigint,
 claimed_notify_version bigint,
 ticket_id uuid references public.icash_automation_tickets(id),
 lease_until timestamptz,
 next_run_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_completed_at timestamptz,
 check(completed_version<=requested_version),
 check(notified_version<=notify_version),
 check((ticket_id is null)=(lease_until is null))
);
create index account_followups_due on icash_work_private.account_followups(next_run_at,account_id);
create index account_followups_ticket on icash_work_private.account_followups(ticket_id) where ticket_id is not null;
alter table icash_work_private.account_followups enable row level security;
revoke all on all tables in schema icash_work_private from public,anon,authenticated;
grant select,insert,update on icash_work_private.account_followups to service_role;
grant select on icash_work_private.dispatch_policy to service_role;
grant update(last_seed_at) on icash_work_private.dispatch_policy to service_role;

alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check
 check(kind in ('customer_updates','discovery','contacts','voice_result','signing_result','voice_dispatch',
 'fulfillment','title_followup','text_ai','market_research','seller_opener','seller_recovery','account_reconcile'));

-- Queue the follow-up in the same transaction that durably finishes primary work.
-- Repeated finish writes and reconciliation tickets never enqueue themselves.
create function icash_work_private.enqueue_account_followup() returns trigger
language plpgsql security invoker set search_path='' as $function$
declare changed boolean;
begin
 if old.state<>'consumed' or new.state not in ('complete','held') or new.kind='account_reconcile' then return new;end if;
 changed:=new.state='complete' and new.kind not in ('customer_updates','customer_attention')
  and new.outcome not in ('supply_target_met','updates_disabled','updates_idle','updates_held',
   'attention_disabled','attention_idle','attention_held','waiting_for_daytime_budget',
   'waiting_for_available_credits','seller_inventory_unavailable','waiting_for_active_call',
   'outside_contact_hours','empty','awaiting_conversation','awaiting_counterparty','customer_signature_needed');
 insert into icash_work_private.account_followups(account_id,notify_version)
 values(new.account_id,case when changed then 1 else 0 end)
 on conflict(account_id) do update set
  requested_version=icash_work_private.account_followups.requested_version+1,
  notify_version=case when changed then icash_work_private.account_followups.requested_version+1
   else icash_work_private.account_followups.notify_version end,
  next_run_at=least(icash_work_private.account_followups.next_run_at,clock_timestamp()),
  updated_at=clock_timestamp();
 return new;
end $function$;
revoke all on function icash_work_private.enqueue_account_followup() from public,anon,authenticated;
create trigger icash_enqueue_account_followup after update of state on public.icash_automation_tickets
 for each row execute function icash_work_private.enqueue_account_followup();

create function public.icash_issue_account_followup() returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare q icash_work_private.account_followups;t public.icash_automation_tickets;stamp timestamptz:=clock_timestamp();
begin
 -- A provider action may outlive a failed primary-finish transaction. Discover
 -- missing accounts from durable outstanding operations, bounded once a minute.
 update icash_work_private.dispatch_policy set last_seed_at=stamp
  where id=1 and (last_seed_at is null or last_seed_at<stamp-interval '1 minute');
 if found then
  insert into icash_work_private.account_followups(account_id)
   select distinct o.account_id from public.icash_operation_spend o
   where o.state in ('reserved','dispatched') and not exists(
    select 1 from icash_work_private.account_followups existing where existing.account_id=o.account_id)
   order by o.account_id limit 10 on conflict(account_id) do nothing;
 end if;
 select f.* into q from icash_work_private.account_followups f
 where f.next_run_at<=stamp and (f.lease_until is null or f.lease_until<=stamp)
  and (f.requested_version>f.completed_version or exists(
   select 1 from public.icash_operation_spend o where o.account_id=f.account_id and o.state in ('reserved','dispatched')))
 order by f.next_run_at,f.account_id for update of f skip locked limit 1;
 if not found then return null;end if;
 -- Only idempotent receipt/notification recovery gets a fresh capability after
 -- a crashed handler. This does not rearm any primary call, text or purchase.
 if q.ticket_id is not null then
  update public.icash_automation_tickets set state='held',outcome='reconciliation_lease_expired',completed_at=stamp
   where id=q.ticket_id and account_id=q.account_id and kind='account_reconcile' and state in ('issued','consumed');
 end if;
 insert into public.icash_automation_tickets(account_id,kind) values(q.account_id,'account_reconcile') returning * into t;
 update icash_work_private.account_followups set ticket_id=t.id,lease_until=stamp+interval '5 minutes',
  claimed_version=requested_version,claimed_notify_version=notify_version,updated_at=stamp where account_id=q.account_id;
 return jsonb_build_object('token',t.token);
end $function$;

create function public.icash_account_followup_context(p_account uuid,p_ticket uuid) returns jsonb
language sql stable security invoker set search_path='' as $function$
 select jsonb_build_object('notify',q.claimed_notify_version>q.notified_version)
 from icash_work_private.account_followups q
 join public.icash_automation_tickets t on t.id=q.ticket_id and t.account_id=q.account_id
 where q.account_id=p_account and q.ticket_id=p_ticket and q.lease_until>clock_timestamp()
  and t.kind='account_reconcile' and t.state='consumed';
$function$;

create function public.icash_finish_account_followup(p_account uuid,p_ticket uuid,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $function$
declare q icash_work_private.account_followups;stamp timestamptz:=clock_timestamp();
begin
 select * into q from icash_work_private.account_followups where account_id=p_account
  and ticket_id=p_ticket and lease_until>stamp for update;
 if not found then return false;end if;
 update public.icash_automation_tickets set state=case when p_success then 'complete' else 'held' end,
  outcome=case when p_success then 'account_reconciled' else 'reconciliation_retry_due' end,completed_at=stamp
  where id=p_ticket and account_id=p_account and kind='account_reconcile' and state='consumed';
 if not found then return false;end if;
 update icash_work_private.account_followups set
  completed_version=case when p_success then greatest(completed_version,q.claimed_version) else completed_version end,
  notified_version=case when p_success then greatest(notified_version,q.claimed_notify_version) else notified_version end,
  next_run_at=case when not p_success then stamp+interval '1 minute'
   when requested_version>q.claimed_version then stamp else stamp+interval '5 minutes' end,
  ticket_id=null,lease_until=null,claimed_version=null,claimed_notify_version=null,
  last_completed_at=case when p_success then stamp else last_completed_at end,updated_at=stamp where account_id=p_account;
 return true;
end $function$;

do $patch$
declare d text;needle text;item record;
begin
 for item in select * from (values
  ('icash_issue_ready_voice_ticket()','137666ef9b3e8a043571f9837bcc3e0b'),
  ('icash_resume_prospecting_ticket()','55da0eefbabc23aa7853b4a7c0d0649b'),
  ('icash_next_before_unstarted_sms_recovery()','39b4627da8c915c05894792f40e305f6')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Parallel work prerequisite changed: %',item.signature;
  end if;
 end loop;
 d:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
 needle:='and current_target.revoked_at is null and current_target.permission_until>now()';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Voice selection changed';end if;
 d:=replace(d,needle,needle||$hours$
   and public.icash_outreach_window_open(current_target.timezone,
    case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
     where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp())$hours$);
 -- At most one new automatic call ticket per second; original 18-outgoing
 -- capacity, account fairness and atomic final dial admission remain unchanged.
 d:=replace(d,'last_voice<now()-interval ''3 seconds''','last_voice<now()-interval ''1 second''');
 execute d;

 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 needle:='and current_target.revoked_at is null and current_target.permission_until>now()';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Budget resume selection changed';end if;
 d:=replace(d,needle,needle||$hours$
    and public.icash_outreach_window_open(current_target.timezone,
     case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
      where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp())$hours$);
 execute d;
 -- Extract the original SMS-only selector, leaving its historical chain intact.
 d:=pg_get_functiondef('public.icash_next_before_unstarted_sms_recovery()'::regprocedure);
 needle:='return public.icash_next_before_sms_inbound_campaign();';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'SMS selector changed';end if;
 d:=replace(d,'FUNCTION public.icash_next_before_unstarted_sms_recovery()','FUNCTION public.icash_issue_ready_seller_text()');
 execute replace(d,needle,'return null;');
end $patch$;

create function public.icash_next_automation_lane(p_lane text) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare t jsonb;
begin
 if p_lane not in ('general','research','voice','messages','recovery') or p_lane is null then raise exception 'Unknown automation lane';end if;
 if not pg_try_advisory_xact_lock(726341927) then return null;end if;
 if not exists(select 1 from icash_work_private.dispatch_policy where id=1 and enabled) then
  -- Rollback/rolling deployment keeps the compatible original dispatcher alive.
  if p_lane='general' then return public.icash_next_automation();end if;
  return null;
 end if;
 if p_lane='general' then return public.icash_next_automation();end if;
 if p_lane='research' then return public.icash_next_acquisition();end if;
 if p_lane='voice' then return public.icash_issue_ready_voice_ticket();end if;
 if p_lane='messages' then
  t:=public.icash_issue_due_text_ai();if t->>'token' is not null then return t;end if;
  t:=public.icash_next_seller_followup();if t->>'token' is not null then return t;end if;
  t:=public.icash_recover_unstarted_seller_opener();if t->>'token' is not null then return t;end if;
  return public.icash_issue_ready_seller_text();
 end if;
 t:=public.icash_issue_due_signing_result();if t->>'token' is not null then return t;end if;
 t:=public.icash_issue_due_voice_result();if t->>'token' is not null then return t;end if;
 return public.icash_issue_account_followup();
end $function$;

revoke all on function public.icash_issue_account_followup(),public.icash_account_followup_context(uuid,uuid),
 public.icash_finish_account_followup(uuid,uuid,boolean),public.icash_issue_ready_seller_text(),public.icash_next_automation_lane(text) from public,anon,authenticated;
grant execute on function public.icash_issue_account_followup(),public.icash_account_followup_context(uuid,uuid),
 public.icash_finish_account_followup(uuid,uuid,boolean),public.icash_issue_ready_seller_text(),public.icash_next_automation_lane(text) to service_role;

-- Existing pending work is recovered even when an account has no new outreach.
-- No provider operation, receipt, reservation, balance or settled charge changes.
insert into icash_work_private.account_followups(account_id)
 select distinct account_id from public.icash_operation_spend where state in ('reserved','dispatched')
 on conflict(account_id) do nothing;
commit;

