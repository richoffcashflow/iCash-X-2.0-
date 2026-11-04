-- Correct derived learning clocks and retain long-window cohorts without buying data.
-- Original provider, operation, message, feature and model receipts are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.icash_refresh_ranker_samples(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.icash_screening_jobs;s icash_ranker_private.samples;first_at timestamptz;interest_at timestamptz;purchase_at timestamptz;closed_at timestamptz;already_converted boolean;
begin
 for j in select q.* from public.icash_screening_jobs q where q.account_id=p_account and q.state='complete'
  and q.event_key like 'discovery:%' and q.result->'financialCheck'->>'status'='eligible'
  and not exists(select 1 from icash_ranker_private.samples x where x.account_id=p_account and x.property_key=md5(q.snapshot->>'propertyId'))
  order by q.created_at,q.id limit 200 loop perform public.icash_capture_ranker_sample(j,true);end loop;
 for s in select x.* from icash_ranker_private.samples x where x.account_id=p_account
  and x.refreshed_at<now()-interval '1 hour' order by x.refreshed_at,x.screening_id limit 200 loop
  select min(e.at) into first_at from (
   select o.dispatched_at as at from public.icash_live_conversations c join public.icash_operation_spend o
    on o.operation_key=c.operation_key and o.account_id=c.account_id
    where c.account_id=p_account and c.screening_id=s.screening_id and c.party='seller' and c.operation_key like 'voice:%' and nullif(c.conversation_id,'') is not null
   -- The accepted provider identity proves this message was submitted; its exact
   -- original operation supplies the clock. Missing dispatch remains unknown.
   union all select o.dispatched_at from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
    where d.account_id=p_account and d.screening_id=s.screening_id and coalesce(d.terms->>'practice','false')<>'true'
     and t.party='seller' and m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null
     and o.dispatched_at>=m.created_at
  ) e where e.at<=now();
  interest_at:=null;purchase_at:=null;closed_at:=null;already_converted:=false;
  if first_at>=s.observed_at then
   select min(e.at) into interest_at from (
    select c.completed_at as at from public.icash_live_conversations c join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
     where c.account_id=p_account and c.screening_id=s.screening_id and c.party='seller' and c.state='complete'
      and nullif(c.conversation_id,'') is not null and o.dispatched_at between first_at and c.completed_at
      and public.icash_call_selling_interest(c.result) and c.result->'optedOut' is distinct from 'true'::jsonb
    union all select public.icash_seller_sms_interest_at(p_account,t.id,first_at,first_at+interval '72 hours')
     from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
     where d.account_id=p_account and d.screening_id=s.screening_id and t.party='seller' and coalesce(d.terms->>'practice','false')<>'true'
   ) e where e.at between first_at and first_at+interval '72 hours' and e.at<=now();
   select min(o.purchase_at) filter(where o.purchase_at between first_at and first_at+interval '30 days'),
    min(o.closed_at) filter(where o.closed_at between first_at and first_at+interval '60 days'),bool_or(o.purchase_at<first_at) into purchase_at,closed_at,already_converted
    from public.icash_learning_deal_outcomes(p_account) o where o.screening_id=s.screening_id;
  end if;
  if already_converted then first_at:=null;end if;
  update icash_ranker_private.samples set exposed_at=first_at,
   baseline=case when first_at<captured_at then null else baseline end,
   interest=case when first_at>=observed_at and now()>=first_at+interval '72 hours' then (interest_at is not null)::integer end,
   contract=case when first_at>=observed_at and now()>=first_at+interval '30 days' then (purchase_at is not null)::integer end,
   closing=case when first_at>=observed_at and now()>=first_at+interval '60 days' then (closed_at is not null)::integer end,
   refreshed_at=now() where screening_id=s.screening_id;
 end loop;
end $$;

create or replace function public.icash_claim_ranker_training() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare token uuid;data jsonb;
begin
 update icash_ranker_private.settings set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 where id=1 and enabled and (lease_until is null or lease_until<now())
  and (last_trained_at is null or last_trained_at<now()-interval '55 minutes') returning lease_token into token;
 if token is null then return null;end if;
 -- Interleave age bands before BOTH contribution limits. A large recent batch
 -- must not evict the older training and later comparison periods needed by
 -- the unchanged 30/60-day outcome windows and chronological validation gaps.
 -- Selection never depends on a positive/negative label, model score or cost.
 with eligible as (
  select x.*,case when exposed_at<=now()-interval '120 days' then 0
   when exposed_at<=now()-interval '60 days' then 1
   when exposed_at<=now()-interval '30 days' then 2 else 3 end age_band
  from icash_ranker_private.samples x where exposed_at>=observed_at and exposed_at<now()-interval '72 hours'
   and refreshed_at>now()-interval '2 hours'
 ), within_band as (
  select x.*,row_number() over(partition by account_id,age_band order by md5(property_key),screening_id) band_n from eligible x
 ), within_account as (
  select x.*,row_number() over(partition by account_id order by band_n,age_band) account_n from within_band x
 ), capped as (
  select x.*,row_number() over(partition by age_band order by band_n,md5(account_id::text),md5(property_key),screening_id) age_n
  from within_account x where account_n<=200
 ), selected as (
  select * from capped order by age_n,age_band limit 5000
 )
 select coalesce(jsonb_agg(jsonb_build_object('property',property_key,'account',md5(account_id::text),'features',features,
  'observedAt',observed_at,'exposedAt',exposed_at,'baseline',baseline,'interest',interest,'contract',contract,'closing',closing)
  order by exposed_at,property_key),'[]') into data from selected;
 return jsonb_build_object('token',token,'asOf',now(),'samples',data);
end $$;

commit;
