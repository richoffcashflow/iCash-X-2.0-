-- Monitor an affordable contact lookup only when a current contact target exists.
begin;
set local lock_timeout='5s';
create or replace function public.icash_account_work_observations()
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
commit;
