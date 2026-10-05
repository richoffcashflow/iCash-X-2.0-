-- Read-only owner reporting. Does not change assignment, billing, schedule, or activation.
-- Aggregate owner planning only; no seller identities, lead ages, or cross-account
-- information are exposed to customer workspaces.
create function public.icash_seller_demand_summary() returns jsonb language sql stable security invoker set search_path='' as $$
 with active as (
 select ac.id,least(w.balance_cents-w.reserved_cents,ac.daily_limit_cents-w.reserved_cents-coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=ac.id and kind='usage' and created_at>now()-interval '24 hours'),0)) capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 where ac.billing_model='daily' and not ac.bot_paused
 and exists(select 1 from public.icash_daily_plans p where p.account_id=ac.id and p.state='active' and p.mode='live')
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=ac.id and b.resolved_at is null)
 ), mature as (
 select i.id,(select count(*) from public.icash_seller_matches m where m.lead_id=i.id) deliveries
 from public.icash_seller_intakes i where i.market_qualified and i.created_at between now()-interval '38 days' and now()-interval '8 days'
 ), due as (
 select i.id from public.icash_seller_intakes i where i.state in ('qualified','assigned') and i.ad_cost_micros is not null and i.next_assignment_at<now()+interval '24 hours'
 and i.checked_at>now()-interval '8 days' and i.data_rights_until>now()
 and (select case when count(*)=0 then now() else public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) end from public.icash_seller_matches m where m.lead_id=i.id)<now()+interval '24 hours'
 and (select count(*) from public.icash_seller_matches m where m.lead_id=i.id)<8
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=i.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=i.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=i.id)
 )
 select jsonb_build_object(
 'activeAccounts',(select count(*) from active),
 'budgetAvailableAccounts',(select count(*) from active where capacity>0),
 'accountsWithoutLead24h',(select count(*) from active a where not exists(select 1 from public.icash_seller_matches m where m.account_id=a.id and m.assigned_at>now()-interval '24 hours')),
 'deliveries24h',(select count(*) from public.icash_seller_matches where assigned_at>now()-interval '24 hours'),
 'deliveries7d',(select count(*) from public.icash_seller_matches where assigned_at>now()-interval '7 days'),
 'qualified7d',(select count(*) from public.icash_seller_intakes where market_qualified and created_at>now()-interval '7 days'),
 'requests7d',(select count(*) from public.icash_seller_intakes where state<>'duplicate' and created_at>now()-interval '7 days'),
 'scheduledLeads24h',(select count(*) from due),
 'matureLeads',(select count(*) from mature),
 'observedRecipientsPerLead',(select avg(deliveries) from mature)
 )
$$;
revoke all on function public.icash_seller_demand_summary() from public,anon,authenticated;
grant execute on function public.icash_seller_demand_summary() to service_role;
