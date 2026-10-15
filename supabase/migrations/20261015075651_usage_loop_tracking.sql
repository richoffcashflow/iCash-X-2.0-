begin;
-- Optional, account-bound prompt measurements. No names, contact details,
-- balances, free text, purchase authority or client-reported conversions.
create table public.icash_usage_loop_observations(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 variant text not null check(variant in ('control','progress')),
 action text not null check(action in ('funding','resume','vip','work','none')),
 reason text not null check(reason in ('start','refill','resume','progress','review','waiting','vip')),
 created_at timestamptz not null default now(),shown_at timestamptz,clicked_at timestamptz,dismissed_at timestamptz
);
create index icash_usage_loop_account_recent on public.icash_usage_loop_observations(account_id,created_at desc);
create index icash_usage_loop_retention on public.icash_usage_loop_observations(created_at);
alter table public.icash_usage_loop_observations enable row level security;
revoke all on public.icash_usage_loop_observations from public,anon,authenticated;
grant all on public.icash_usage_loop_observations to service_role;

create function public.icash_prune_usage_loop_observations() returns integer language plpgsql security invoker set search_path='' as $$
declare removed integer;
begin
 delete from public.icash_usage_loop_observations where id in (
  select id from public.icash_usage_loop_observations where created_at<now()-interval '30 days'
  order by created_at for update skip locked limit 500
 );
 get diagnostics removed=row_count;return removed;
end $$;

create function public.icash_create_usage_loop_observation(p_account uuid,p_action text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item public.icash_usage_loop_observations;assigned text;
begin
 if p_action is null or p_action not in ('funding','resume','vip','work','none') or p_reason is null or p_reason not in ('start','refill','resume','progress','review','waiting','vip') then return null;end if;
 if not exists(select 1 from public.icash_accounts where id=p_account) then return null;end if;
 assigned:=case when (get_byte(decode(substr(md5(p_account::text),1,2),'hex'),0)/16)%2=0 then 'control' else 'progress' end;
 -- Repeat polls reuse the same observation without writing another impression.
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,471));
 select * into item from public.icash_usage_loop_observations
 where account_id=p_account and action=p_action and reason=p_reason and variant=assigned and created_at>=now()-interval '30 minutes'
 order by created_at desc limit 1;
 if not found then
  if (select count(*) from public.icash_usage_loop_observations where account_id=p_account and created_at>=now()-interval '1 hour')>=100 then return null;end if;
  perform public.icash_prune_usage_loop_observations();
  insert into public.icash_usage_loop_observations(account_id,variant,action,reason) values(p_account,assigned,p_action,p_reason) returning * into item;
 end if;
 return jsonb_build_object('impressionId',item.id,'variant',item.variant);
end $$;

create function public.icash_record_usage_loop_event(p_user uuid,p_observation uuid,p_event text,p_action text,p_reason text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare item public.icash_usage_loop_observations;
begin
 if p_event is null or p_event not in ('shown','clicked','dismissed') then return false;end if;
 select o.* into item from public.icash_usage_loop_observations o join public.icash_accounts a on a.id=o.account_id
 where o.id=p_observation and a.owner_user_id=p_user and o.action=p_action and o.reason=p_reason
  and o.created_at>=now()-interval '24 hours' for update of o;
 if not found then return false;end if;
 if p_event='shown' and item.shown_at is null then update public.icash_usage_loop_observations set shown_at=now() where id=item.id;
 elsif p_event='clicked' and item.clicked_at is null then update public.icash_usage_loop_observations set clicked_at=now() where id=item.id;
 elsif p_event='dismissed' and item.dismissed_at is null then update public.icash_usage_loop_observations set dismissed_at=now() where id=item.id;
 end if;
 return true;
end $$;

-- Fixed, fully observed windows; outcomes come from payment and work records.
-- Counts are overlapping milestones, not an inferred sequential funnel.
create function public.icash_usage_loop_report(p_actor uuid,p_include_owner boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';report jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 if p_include_owner is null then raise exception 'Invalid report option';end if;
 perform public.icash_prune_usage_loop_observations();
 with accounts as materialized (
  select id from public.icash_accounts where p_include_owner or owner_user_id<>owner_id
 ), paid as materialized (
  select f.id,f.account_id,greatest(f.paid_at,f.credited_at) as funded_at,
   f.daily_plan_id is null and not exists(select 1 from public.icash_auto_recharge_attempts x where x.order_id=f.id) as manual
  from public.icash_funding_orders f join accounts a on a.id=f.account_id
  where f.mode='live' and f.state='paid' and f.paid_at is not null and f.credited_at is not null and f.price_cents>0
   and exists(select 1 from public.icash_credit_ledger l where l.account_id=f.account_id and l.event_key='stripe-funding:'||f.id::text
    and l.kind='purchase' and l.delta_cents>0 and l.evidence_ref=f.stripe_payment_id)
 ), first_funding as (
  select account_id,min(funded_at) as at from paid group by account_id
 ), cohort as materialized (
  select * from first_funding where at>=now()-interval '30 days' and at<=now()-interval '7 days'
 ), outcomes as (
  select c.account_id,
   exists(select 1 from public.icash_screening_jobs s where s.account_id=c.account_id and s.state='complete' and jsonb_typeof(s.result)='object'
    and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
    and coalesce(s.result->>'practice','false')<>'true'
    and coalesce(s.result->'property'->>'propertyId','') not like 'practice_%'
    and s.completed_at>=c.at and s.completed_at<c.at+interval '7 days') as first_result,
   (select count(*) from paid p where p.account_id=c.account_id and p.manual and p.funded_at<c.at+interval '7 days')>=2 as manual_refill,
   (select count(distinct (l.created_at at time zone 'America/Chicago')::date) from public.icash_credit_ledger l
    where l.account_id=c.account_id and l.kind='usage' and l.delta_cents<0 and l.created_at>=c.at and l.created_at<c.at+interval '7 days')>=2 as repeat_usage
  from cohort c
 ), observations as materialized (
  select o.* from public.icash_usage_loop_observations o join accounts a on a.id=o.account_id where o.shown_at is not null and o.created_at>=now()-interval '30 days'
 ), funding_exposure as (
  select account_id,variant,min(shown_at) as at from observations where action='funding' group by account_id,variant
 ), observed as (
  select * from funding_exposure where at>=now()-interval '30 days' and at<=now()-interval '7 days'
 ), variants as (
  select v.variant,count(e.account_id) as observed_accounts,
   count(e.account_id) filter(where exists(select 1 from observations o where o.account_id=e.account_id and o.action='funding'
    and o.clicked_at>=e.at and o.clicked_at<e.at+interval '7 days')) as clicked_accounts,
   count(e.account_id) filter(where exists(select 1 from paid p where p.account_id=e.account_id and p.manual
    and p.funded_at>=e.at and p.funded_at<e.at+interval '7 days')) as funded_accounts
  from (values('control'),('progress')) v(variant) left join observed e on e.variant=v.variant group by v.variant
 )
 select jsonb_build_object('checkedAt',now(),'cohortStart',now()-interval '30 days','cohortEnd',now()-interval '7 days',
  'observationDays',7,'retentionDays',30,'includeOwner',p_include_owner,
  'cohort',jsonb_build_object('firstFunded',(select count(*) from cohort),'firstResult',(select count(*) from outcomes where first_result),
   'secondManualRefill',(select count(*) from outcomes where manual_refill),'repeatUsage',(select count(*) from outcomes where repeat_usage)),
  'recent',jsonb_build_object('shownAccounts',(select count(distinct account_id) from observations where shown_at>=now()-interval '7 days'),
   'clickedAccounts',(select count(distinct account_id) from observations where shown_at>=now()-interval '7 days' and clicked_at is not null),
   'dismissedAccounts',(select count(distinct account_id) from observations where shown_at>=now()-interval '7 days' and dismissed_at is not null)),
  'variants',(select jsonb_agg(jsonb_build_object('variant',variant,'observedAccounts',observed_accounts,'clickedAccounts',clicked_accounts,'fundedAccounts',funded_accounts) order by variant) from variants)
 ) into report;
 return report;
end $$;
revoke all on function public.icash_prune_usage_loop_observations(),public.icash_create_usage_loop_observation(uuid,text,text),public.icash_record_usage_loop_event(uuid,uuid,text,text,text),public.icash_usage_loop_report(uuid,boolean) from public,anon,authenticated;
grant execute on function public.icash_prune_usage_loop_observations(),public.icash_create_usage_loop_observation(uuid,text,text),public.icash_record_usage_loop_event(uuid,uuid,text,text,text),public.icash_usage_loop_report(uuid,boolean) to service_role;
commit;
