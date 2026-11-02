-- Account-level completed work is a health signal, independent of worker uptime.
begin;
set local lock_timeout='5s';
create table icash_reliability_private.account_work_states(
 account_id uuid primary key references public.icash_accounts(id),
 reason text not null check(reason in ('configuration_expired','configuration_disabled','system_paused','no_completed_work','pending_work')),
 since timestamptz not null,last_completed_at timestamptz,available_cents bigint not null,
 checked_at timestamptz not null
);
alter table icash_reliability_private.account_work_states enable row level security;
revoke all on icash_reliability_private.account_work_states from public,anon,authenticated;
grant select,insert,update,delete on icash_reliability_private.account_work_states to service_role;
-- icash_discovery_results_account already indexes (account_id,created_at desc).
create index icash_account_work_completed on public.icash_operation_spend(account_id,settled_at desc)
 where state='settled' and (actual_micros>0 or charged_cents>0);
create index icash_account_work_control on public.icash_control_events(account_id,created_at desc,id desc) where property_id is null;
create index icash_account_work_funding on public.icash_funding_orders(account_id,credited_at desc) where mode='live' and state='paid' and credited_at is not null;

create function public.icash_account_work_observations()
returns table(account_id uuid,reason text,since timestamptz,last_completed_at timestamptz,available_cents bigint)
language sql stable security invoker set search_path='' as $fn$
 with funded as materialized (
  select a.id,a.bot_paused,a.created_at,d.enabled,d.auto_enabled,d.contacts_enabled,d.data_rights_until,
   sr.enabled search_enabled,cr.enabled contact_enabled,sr.expires_at search_expires,cr.expires_at contact_expires,
   w.balance_cents,public.icash_prospecting_available(a.id) available,
   least(public.icash_research_admission_quote(a.id,'property_search',sr.charge_cents),
    public.icash_research_admission_quote(a.id,'owner_enrichment',cr.charge_cents)) minimum,
   public.icash_research_admission_quote(a.id,'property_search',sr.charge_cents) search_minimum,
   control.action,control.created_at control_at,funding.credited_at
  from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
  left join public.icash_discovery_configs d on d.account_id=a.id
  left join public.icash_operation_rates sr on sr.id=d.rate_id
  left join public.icash_operation_rates cr on cr.id=d.contact_rate_id
  left join lateral(select action,created_at from public.icash_control_events where account_id=a.id and property_id is null order by created_at desc,id desc limit 1) control on true
  left join lateral(select credited_at from public.icash_funding_orders where account_id=a.id and mode='live' and state='paid' and credited_at is not null order by credited_at desc limit 1) funding on true
  where a.id<>'48dfb798-8c1a-404f-88c0-c396cc067062' and w.balance_cents>0
   and public.icash_membership_work_allowed(a.id) and a.workspace_ack_version is not null
   and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
   and not exists(select 1 from public.icash_support_cancel_requests where account_id=a.id and confirmed_at is not null
    and confirmed_at>coalesce(control.created_at,'-infinity'::timestamptz))
   and (not a.bot_paused or control.action is distinct from 'pause')
 ), observed as (
  select f.*,greatest(work.settled_at,receipt.created_at) completed,
   greatest(f.created_at,f.credited_at,case when action='resume' then control_at end,work.settled_at,receipt.created_at) last_progress,
   pending.dispatched_at pending_at
  from funded f
  left join lateral(select settled_at from public.icash_operation_spend where account_id=f.id and state='settled' and (actual_micros>0 or charged_cents>0) order by settled_at desc limit 1) work on true
  left join lateral(select created_at from public.icash_discovery_results where account_id=f.id order by created_at desc limit 1) receipt on true
  left join lateral(select min(coalesce(dispatched_at,created_at)) dispatched_at from public.icash_operation_spend where account_id=f.id and state in ('reserved','dispatched')) pending on true
 ), classified as (
  select *,case
   when bot_paused then 'system_paused'
   when enabled is distinct from true or auto_enabled is distinct from true or contacts_enabled is distinct from true or search_enabled is distinct from true or contact_enabled is distinct from true then 'configuration_disabled'
   when least(data_rights_until,search_expires,contact_expires)<=now() then 'configuration_expired'
   when available<coalesce(minimum,1) and pending_at<=now()-interval '30 minutes' then 'pending_work'
   when last_progress<=now()-interval '30 minutes'
    and (available>=search_minimum or public.icash_enrichment_before_prospecting_budget(id) is not null) then 'no_completed_work'
   end problem
  from observed where balance_cents>=coalesce(minimum,1)
   and (available>=coalesce(minimum,1) or pending_at<=now()-interval '30 minutes')
   and greatest(created_at,credited_at,case when action='resume' then control_at end)<=now()-interval '5 minutes'
 )
 select id,problem,case when problem='pending_work' then pending_at
  when problem='configuration_expired' then least(data_rights_until,search_expires,contact_expires)
  else last_progress end,completed,available from classified where problem is not null;
$fn$;

create function public.icash_refresh_account_work_snapshot() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' as $fn$
declare v_report jsonb;progress jsonb;
begin
 perform pg_advisory_xact_lock(916014);
 v_report:=public.icash_refresh_reviewed_workflow_snapshot();
 insert into icash_reliability_private.account_work_states(account_id,reason,since,last_completed_at,available_cents,checked_at)
 select account_id,reason,since,last_completed_at,available_cents,now() from public.icash_account_work_observations()
 on conflict(account_id) do update set reason=excluded.reason,
  since=case when account_work_states.reason=excluded.reason then least(account_work_states.since,excluded.since) else excluded.since end,
  last_completed_at=excluded.last_completed_at,available_cents=excluded.available_cents,checked_at=excluded.checked_at;
 delete from icash_reliability_private.account_work_states where checked_at<now();
 select jsonb_build_object('checkedAt',now(),'affectedAccounts',count(*),
  'expiredConfigurations',count(*) filter(where reason='configuration_expired'),
  'unexpectedPauses',count(*) filter(where reason='system_paused'),
  'stalledAccounts',count(*) filter(where reason='no_completed_work'),
  'pendingAccounts',count(*) filter(where reason='pending_work'),
  'samples',coalesce((select jsonb_agg(to_jsonb(s)) from(select account_id as "accountId",reason,since,
   last_completed_at as "lastCompletedAt",available_cents as "availableCents" from icash_reliability_private.account_work_states order by since,account_id limit 25)s),'[]'::jsonb))
 into progress from icash_reliability_private.account_work_states;
 v_report:=v_report||jsonb_build_object('accountProgress',progress,'issueCount',
  (v_report->>'issueCount')::integer-coalesce((v_report->'accountProgress'->>'affectedAccounts')::integer,0)+(progress->>'affectedAccounts')::integer);
 update icash_reliability_private.snapshots set report=v_report where id=1;
 return v_report;
end $fn$;

create function public.icash_account_work_health(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $fn$
 select case when not exists(select 1 from icash_reliability_private.snapshots where id=1
  and checked_at>now()-interval '3 minutes' and (report->'accountProgress'->>'checkedAt')::timestamptz>now()-interval '3 minutes')
  then jsonb_build_object('status','unavailable')
  else coalesce((select jsonb_build_object('status','blocked','reason',reason,'since',since)
   from icash_reliability_private.account_work_states where account_id=p_account and checked_at>now()-interval '3 minutes'),jsonb_build_object('status','ok')) end;
$fn$;
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_progress(uuid)'::regprocedure);
 needle:='''budgetId'',b.id,';
 if strpos(d,needle)=0 then raise exception 'Progress shape changed';end if;
 execute replace(d,needle,'''health'',public.icash_account_work_health(p_account),'||needle);
 d:=pg_get_functiondef('public.icash_reliability_severity(jsonb,timestamptz)'::regprocedure);
 if md5(d)<>'e3fa3b4b4e7d59f119d49cd9c75658b5' then raise exception 'Severity policy changed';end if;
 needle:='select case';
 execute replace(d,needle,needle||E'\n  when coalesce((p_report->''snapshot''->''accountProgress''->>''affectedAccounts'')::integer,0)>=3 then ''critical''');
end $patch$;
-- Separate incident memory rearms an account outage even when older workflow
-- receipts keep the shared incident open. Existing notification shape is stable.
alter table icash_reliability_private.component_outages drop constraint component_outages_component_check;
alter table icash_reliability_private.component_outages add constraint component_outages_component_check check(component in ('worker','maintenance','monitor','account_progress'));
insert into icash_reliability_private.component_outages(component) values('account_progress');
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_refresh_reliability_incident(text)'::regprocedure);
 if md5(d)<>'fbbd8b4dcd41197284b1b68074c5ef4f' then raise exception 'Incident refresh source changed';end if;
 needle:='foreach component_name in array array[''worker'',''maintenance'',''monitor''] loop';
 if strpos(d,needle)=0 then raise exception 'Component loop changed';end if;
 d:=replace(d,needle,'foreach component_name in array array[''worker'',''maintenance'',''monitor'',''account_progress''] loop
  if component_name=''account_progress'' and (report->''snapshot''->''accountProgress'' is null or (report->''snapshot''->''accountProgress''->>''checkedAt'')::timestamptz<=now()-interval ''3 minutes'') then continue;end if;');
 needle:='if component_name=any(found_reasons) then';
 if strpos(d,needle)=0 then raise exception 'Component detection changed';end if;
 d:=replace(d,needle,'if component_name=any(found_reasons) or (component_name=''account_progress'' and coalesce((report->''snapshot''->''accountProgress''->>''affectedAccounts'')::integer,0)>0) then');
 needle:='component_level:=case when report->''components''->component_name->>''status''=''degraded'' then 1 else 2 end;';
 if strpos(d,needle)=0 then raise exception 'Component severity changed';end if;
 d:=replace(d,needle,'component_level:=case when component_name=''account_progress'' then case when (report->''snapshot''->''accountProgress''->>''affectedAccounts'')::integer>=3 then 2 else 1 end when report->''components''->component_name->>''status''=''degraded'' then 1 else 2 end;');
 needle:='if active.id is not null and found_reasons&&array[''worker'',''maintenance'',''monitor''] then';
 if strpos(d,needle)=0 then raise exception 'Reminder policy changed';end if;
 d:=replace(d,needle,'if active.id is not null and (found_reasons&&array[''worker'',''maintenance'',''monitor''] or coalesce((report->''snapshot''->''accountProgress''->>''affectedAccounts'')::integer,0)>0) then');
 execute d;
end $patch$;
revoke all on function public.icash_account_work_observations(),public.icash_refresh_account_work_snapshot(),public.icash_account_work_health(uuid) from public,anon,authenticated;
grant execute on function public.icash_account_work_observations(),public.icash_refresh_account_work_snapshot(),public.icash_account_work_health(uuid) to service_role;
commit;
