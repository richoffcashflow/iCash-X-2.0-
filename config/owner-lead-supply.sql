-- Read-only owner planning. Does not assign leads, charge credits, or start ads.
create or replace function public.icash_owner_lead_supply(p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';result jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 with accounts as materialized (
  select a.id,a.bot_paused,coalesce(w.balance_cents,0) balance,
   public.icash_membership_work_allowed(a.id) membership_allowed,
   public.icash_credit_acquisition_allowed(a.id) ready
  from public.icash_accounts a left join public.icash_wallets w on w.account_id=a.id
  where a.owner_user_id<>owner_id
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
 ), leads as materialized (
  select i.id,i.created_at,i.state,i.numbers_passed,i.market_qualified,
   i.numbers_passed and i.market_qualified and i.state in ('qualified','assigned') qualified
  from public.icash_seller_intakes i
  where i.canonical_id is null and i.state<>'duplicate'
   and i.contact_consent_scope is distinct from 'icash_x_demo'
   and i.created_at>=now()-interval '38 days' and i.created_at<now()
 ), recent_deliveries as (
  -- Contact-only Meta leads (including CSV imports) reach a customer's
  -- workspace before address research creates a seller match.
  select m.lead_id,m.account_id from public.icash_seller_matches m
  where m.assigned_at>=now()-interval '24 hours' and m.assigned_at<now()
  union all
  select m.lead_id,m.account_id from public.icash_meta_leads m
  where m.routed_at>=now()-interval '24 hours' and m.routed_at<now()
 ), recent_coverage as (
  select count(distinct m.account_id) covered
  from recent_deliveries m join accounts a on a.id=m.account_id and a.ready
  join public.icash_seller_intakes i on i.id=m.lead_id
  where i.canonical_id is null and i.state<>'duplicate'
   and i.contact_consent_scope is distinct from 'icash_x_demo'
 ), mature as (
  -- Completed eight-day research windows. Cap historical eight-user cohorts
  -- at today's three-recipient policy; exclude owner and test deliveries.
  select l.id,least(3,(select count(distinct m.account_id) from public.icash_seller_matches m
   join accounts a on a.id=m.account_id where m.lead_id=l.id)) deliveries
  from leads l where l.numbers_passed and l.market_qualified and l.created_at<now()-interval '8 days'
 ), resolved as (
  -- Allow 24 hours for research; pending requests cannot depress the yield.
  select l.qualified from leads l
  where l.created_at>=now()-interval '8 days' and l.created_at<now()-interval '24 hours'
   and l.state not in ('received','awaiting_address','looking_up','checking')
 )
 select jsonb_build_object(
  'checkedAt',now(),
  'activeAccounts',(select count(*) from accounts where ready),
  'coveredAccounts24h',(select covered from recent_coverage),
  'qualified24h',(select count(*) from leads where qualified and created_at>=now()-interval '24 hours'),
  'pausedAccounts',(select count(*) from accounts where membership_allowed and bot_paused),
  'unfundedAccounts',(select count(*) from accounts where membership_allowed and not bot_paused and balance<=0),
  'setupAccounts',(select count(*) from accounts where membership_allowed and not bot_paused and balance>0 and not ready),
  'matureLeads',(select count(*) from mature),
  'matureDeliveries',(select coalesce(sum(deliveries),0) from mature),
  'resolvedRequests7d',(select count(*) from resolved),
  'qualifiedRequests7d',(select count(*) from resolved where qualified)
 ) into result;
 return result;
end $$;
revoke all on function public.icash_owner_lead_supply(uuid) from public,anon,authenticated;
grant execute on function public.icash_owner_lead_supply(uuid) to service_role;
