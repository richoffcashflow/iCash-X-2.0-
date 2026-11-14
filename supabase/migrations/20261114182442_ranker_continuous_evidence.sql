-- Rotate bounded evidence fairly without choosing successful labels or changing
-- the immutable features, exposure clocks, comparison groups or model gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $guard$
begin
 if md5(pg_get_functiondef('public.icash_claim_ranker_training()'::regprocedure))
  is distinct from '8ed37cde981cc95fb6bccb6e2ce20ebe' then
  raise exception 'Ranker training claim predecessor changed';
 end if;
 if md5(pg_get_functiondef('public.icash_finish_ranker_training(uuid,jsonb,integer)'::regprocedure))
  is distinct from '6002742a6283dad2fb7536110b954557' then
  raise exception 'Ranker qualification predecessor changed';
 end if;
end $guard$;

alter table icash_ranker_private.settings add column export_sequence bigint not null default 0 check(export_sequence>=0);
alter table icash_ranker_private.samples add column last_export_sequence bigint not null default 0 check(last_export_sequence>=0);

create or replace function public.icash_claim_ranker_training() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare token uuid;sequence bigint;data jsonb;eligible_count bigint;unseen_count bigint;newly_covered bigint;
begin
 -- The original singleton lock/lease also serializes rotation. Failed work does
 -- not activate a model; its previously exported evidence need not block others.
 update icash_ranker_private.settings set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',
  export_sequence=export_sequence+1
 where id=1 and enabled and (lease_until is null or lease_until<now())
  and (last_trained_at is null or last_trained_at<now()-interval '12 minutes')
 returning lease_token,export_sequence into token,sequence;
 if token is null then return null;end if;
 -- Earliest eligible exposure owns each property BEFORE the two caps. The
 -- trainer repeats this guard. Duplicate accounts must not waste export slots.
 -- Age bands retain long-window evidence. Least-recently exported candidates
 -- rotate within each band/account and globally; labels/predictions/costs never
 -- affect selection, and a large recent cohort cannot evict older cohorts.
 with eligible as materialized (
  select distinct on (x.property_key) x.*,case when exposed_at<=now()-interval '120 days' then 0
   when exposed_at<=now()-interval '60 days' then 1
   when exposed_at<=now()-interval '30 days' then 2 else 3 end age_band
  from icash_ranker_private.samples x where exposed_at>=observed_at and exposed_at<now()-interval '72 hours'
   and refreshed_at>now()-interval '2 hours'
  order by x.property_key,x.exposed_at,x.screening_id
 ), within_band as (
  select x.*,row_number() over(partition by account_id,age_band order by last_export_sequence,captured_at,md5(property_key),screening_id) band_n
  from eligible x
 ), within_account as (
  select x.*,row_number() over(partition by account_id order by band_n,age_band) account_n from within_band x
 ), capped as (
  select x.*,row_number() over(partition by age_band order by last_export_sequence,captured_at,band_n,md5(account_id::text),md5(property_key),screening_id) age_n
  from within_account x where account_n<=200
 ), selected as materialized (
  select * from capped order by age_n,age_band limit 5000
 ), marked as (
  update icash_ranker_private.samples x set last_export_sequence=sequence from selected s
  where x.screening_id=s.screening_id returning x.screening_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('property',property_key,'account',md5(account_id::text),'features',features,
  'observedAt',observed_at,'exposedAt',exposed_at,'baseline',baseline,'interest',interest,'contract',contract,'closing',closing)
  order by exposed_at,property_key),'[]'),
  (select count(*) from eligible),(select count(*) from eligible where last_export_sequence=0),
  count(*) filter(where last_export_sequence=0)
 into data,eligible_count,unseen_count,newly_covered from selected;
 return jsonb_build_object('token',token,'asOf',now(),'samples',data,'sampling',jsonb_build_object(
  'version','age-fair-v2','sequence',sequence,'eligible',eligible_count,'selected',jsonb_array_length(data),
  'newlyCovered',newly_covered,'remainingUnseen',unseen_count-newly_covered));
end $$;

-- CREATE OR REPLACE retains the service-only grants. The original finish
-- function, model policy, settings.enabled and active model remain unchanged.
commit;
