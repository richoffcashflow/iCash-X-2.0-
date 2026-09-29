-- Existing visitors retain the guided flow. Only newly created setups enter this test.
alter table public.icash_bot_setups add column flow_variant text not null default 'guided' check(flow_variant in ('guided','quick'));
alter table public.icash_bot_setups add column flow_experiment text;
alter table public.icash_bot_setups alter column flow_variant set default (case when random()<0.5 then 'guided' else 'quick' end);
alter table public.icash_bot_setups alter column flow_experiment set default 'quick_setup_v1';
create function public.icash_quick_setup_report() returns jsonb language sql stable set search_path='' as $$
with cohort as (
 select * from public.icash_bot_setups where flow_experiment='quick_setup_v1' and created_at<now()-interval '24 hours'
), outcomes as (
 select s.id,s.flow_variant,
 (select count(*) from public.icash_funding_orders o where o.mode='live' and o.state='paid' and (o.guest_hash=s.guest_hash or (s.account_id is not null and o.account_id=s.account_id)) and o.paid_at>=s.created_at and o.paid_at<s.created_at+interval '24 hours') as purchases_24h,
 (select coalesce(sum(o.price_cents),0) from public.icash_funding_orders o where o.mode='live' and o.state='paid' and (o.guest_hash=s.guest_hash or (s.account_id is not null and o.account_id=s.account_id)) and o.paid_at>=s.created_at and o.paid_at<s.created_at+interval '24 hours') as revenue_24h_cents,
 (select count(*) from public.icash_funding_orders o where o.mode='live' and o.state='paid' and (o.guest_hash=s.guest_hash or (s.account_id is not null and o.account_id=s.account_id)) and o.paid_at>=s.created_at and o.paid_at<s.created_at+interval '7 days') as purchases_7d,
 s.created_at<now()-interval '7 days' as mature_7d
 from cohort s
), report as (
 select flow_variant,count(*) as visitors,count(*) filter(where purchases_24h>0) as funded_24h,sum(revenue_24h_cents) as revenue_24h_cents,
 count(*) filter(where mature_7d) as visitors_7d,count(*) filter(where mature_7d and purchases_7d>1) as repeat_buyers_7d
 from outcomes group by flow_variant
) select coalesce(jsonb_agg(to_jsonb(report)),'[]'::jsonb) from report;
$$;
revoke all on function public.icash_quick_setup_report() from public,anon,authenticated;
grant execute on function public.icash_quick_setup_report() to service_role;
