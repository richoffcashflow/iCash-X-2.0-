begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Private, compact property vectors and auditable model receipts. No new provider spend.
create schema icash_ranker_private;
revoke all on schema icash_ranker_private from public,anon,authenticated;
grant usage on schema icash_ranker_private to service_role;
create table icash_ranker_private.runs(
 id uuid primary key,created_at timestamptz not null default now(),status text not null check(status in ('collecting','rejected','qualified')),
 result jsonb not null,elapsed_ms integer not null check(elapsed_ms between 0 and 45000)
);
create table icash_ranker_private.settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 active_model uuid references icash_ranker_private.runs(id),lease_token uuid,lease_until timestamptz,last_trained_at timestamptz
);
insert into icash_ranker_private.settings(id) values(1);
create table icash_ranker_private.samples(
 screening_id uuid primary key references public.icash_screening_jobs(id),account_id uuid not null references public.icash_accounts(id),
 property_key text not null,features double precision[] not null check(cardinality(features)=12),
 observed_at timestamptz not null,captured_at timestamptz not null default now(),baseline double precision,
 cohort text not null check(cohort in ('historical','baseline','learned','collecting')),
 model_id uuid references icash_ranker_private.runs(id),prediction double precision check(prediction between 0 and 1),
 exposed_at timestamptz,interest integer check(interest in (0,1)),contract integer check(contract in (0,1)),closing integer check(closing in (0,1)),
 refreshed_at timestamptz not null default '-infinity',unique(account_id,property_key)
);
create index ranker_sample_refresh on icash_ranker_private.samples(account_id,refreshed_at,screening_id);
create index ranker_sample_model on icash_ranker_private.samples(model_id);
create index ranker_sample_exposed on icash_ranker_private.samples(exposed_at) where exposed_at is not null;
alter table icash_ranker_private.samples enable row level security;
alter table icash_ranker_private.runs enable row level security;
alter table icash_ranker_private.settings enable row level security;
revoke all on all tables in schema icash_ranker_private from public,anon,authenticated;
grant all on all tables in schema icash_ranker_private to service_role;

create function public.icash_ranker_features(p_raw jsonb) returns double precision[]
language plpgsql immutable security invoker set search_path='' as $$
declare keys text[]:=array['estimated_value','estimated_equity_percentage','estimated_repair_cost','living_area_sqft','year_built','total_estimated_loan_balance'];
 scales numeric[]:=array[1000000,100,200000,5000,250,1000000];x numeric;v text;result double precision[]:='{}';i integer;
begin
 for i in 1..6 loop
  v:=p_raw->>keys[i];
  if v is not null and length(v)<32 and v ~ '^[0-9]+([.][0-9]+)?$' then
   x:=v::numeric;if i=5 then x:=x-1800;end if;
   result:=result||array[greatest(0,least(1,x/scales[i]))::double precision,0::double precision];
  else result:=result||array[0::double precision,1::double precision];end if;
 end loop;return result;
end $$;

-- Save once, before any observed outcome. Historical data cannot manufacture a baseline.
create function public.icash_capture_ranker_sample(j public.icash_screening_jobs,p_historical boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare features double precision[];observed timestamptz;baseline double precision;model jsonb;model_id uuid;prediction double precision;logit double precision;cohort text:='collecting';i integer;
begin
 if j.state is distinct from 'complete' or j.result->'financialCheck'->>'status' is distinct from 'eligible'
  or coalesce(j.event_key,'') not like 'discovery:%' or coalesce(j.snapshot->>'practice','false')='true'
  or coalesce(j.snapshot->>'propertyId','') !~ '^prop_[0-9]{1,20}$'
  or j.snapshot ? 'sellerRequest' or jsonb_typeof(j.snapshot->'raw'->'data') is distinct from 'object' then return;end if;
 begin observed:=(j.snapshot->>'fetchedAt')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then return;end;
 if observed is null or observed>now() or observed>j.created_at or j.completed_at is null then return;end if;
 features:=public.icash_ranker_features(j.snapshot->'raw'->'data');
 if p_historical then cohort:='historical';else
  baseline:=public.icash_opportunity_score_before_ranker(j.account_id,j.result,j.snapshot->'raw'->'data'->>'zip');
  select r.id,r.result->'model' into model_id,model from icash_ranker_private.settings s
   join icash_ranker_private.runs r on r.id=s.active_model
   where s.id=1 and s.enabled and r.status='qualified' and r.created_at>now()-interval '7 days';
  if model is not null then
   logit:=(model->>'intercept')::double precision;
   for i in 1..12 loop logit:=logit+features[i]*(model->'weights'->>(i-1))::double precision;end loop;
   prediction:=1/(1+exp(-greatest(-30,least(30,logit))));
   cohort:=case when (('x'||substr(md5('ranker-v1:'||j.account_id::text),1,8))::bit(32)::bigint%5)=0 then 'baseline' else 'learned' end;
  end if;
 end if;
 insert into icash_ranker_private.samples(screening_id,account_id,property_key,features,observed_at,baseline,cohort,model_id,prediction)
 values(j.id,j.account_id,md5(j.snapshot->>'propertyId'),features,observed,baseline,cohort,model_id,prediction) on conflict do nothing;
end $$;

alter function public.icash_opportunity_score(uuid,jsonb,text) rename to icash_opportunity_score_before_ranker;
create function public.icash_opportunity_score(p_account uuid,p_result jsonb,p_zip text) returns numeric
language plpgsql stable security invoker set search_path='' as $$
declare base numeric;prediction double precision;
begin
 base:=public.icash_opportunity_score_before_ranker(p_account,p_result,p_zip);
 if p_result->'financialCheck'->>'status' is distinct from 'eligible' then return base;end if;
 select a.prediction into prediction from icash_ranker_private.samples a
 join icash_ranker_private.settings s on s.id=1 and s.enabled and s.active_model is not null
 join icash_ranker_private.runs r on r.id=a.model_id and r.status='qualified' and r.created_at>now()-interval '7 days'
 where a.account_id=p_account and a.property_key=md5(p_result->'property'->>'propertyId') and a.cohort='learned';
 return case when prediction is null then base else 0.85*base+0.15*prediction::numeric end;
end $$;
create function public.icash_ranker_screened() returns trigger
language plpgsql security invoker set search_path='' as $$begin
 -- Never rotate a sample on recalculation or reassign an existing conversation.
 if tg_op='INSERT' or old.state is distinct from 'complete' then perform public.icash_capture_ranker_sample(new,false);end if;
 return new;
end $$;
create trigger icash_ranker_screened after insert or update of state,result on public.icash_screening_jobs
for each row when(new.state='complete') execute function public.icash_ranker_screened();

-- Reuse the existing bounded account refresh queue, away from outreach dispatch.
create function public.icash_refresh_ranker_samples(p_account uuid) returns void
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
   union all select m.created_at from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    where d.account_id=p_account and d.screening_id=s.screening_id and coalesce(d.terms->>'practice','false')<>'true'
     and t.party='seller' and m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null
  ) e where e.at<=now();
  interest_at:=null;purchase_at:=null;closed_at:=null;already_converted:=false;
  if first_at>=s.observed_at then
   select min(e.at) into interest_at from (
    select c.completed_at as at from public.icash_live_conversations c join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
     where c.account_id=p_account and c.screening_id=s.screening_id and c.party='seller' and c.state='complete'
      and nullif(c.conversation_id,'') is not null and o.dispatched_at between first_at and c.completed_at
      and c.result->'interested'='true'::jsonb and c.result->'optedOut' is distinct from 'true'::jsonb
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
alter function public.icash_refresh_learning_account(uuid) rename to icash_refresh_learning_before_ranker;
create function public.icash_refresh_learning_account(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$begin
 perform public.icash_refresh_learning_before_ranker(p_account);
 perform public.icash_refresh_ranker_samples(p_account);
end $$;

create function public.icash_claim_ranker_training() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare token uuid;data jsonb;
begin
 update icash_ranker_private.settings set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 where id=1 and enabled and (lease_until is null or lease_until<now())
  and (last_trained_at is null or last_trained_at<now()-interval '55 minutes') returning lease_token into token;
 if token is null then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('property',property_key,'account',md5(account_id::text),'features',features,
  'observedAt',observed_at,'exposedAt',exposed_at,'baseline',baseline,'interest',interest,'contract',contract,'closing',closing)
  order by exposed_at,property_key),'[]') into data from (
   select * from (select x.*,row_number() over(partition by account_id order by md5(property_key),screening_id) as n
    from icash_ranker_private.samples x where exposed_at>=observed_at and exposed_at<now()-interval '72 hours'
     and refreshed_at>now()-interval '2 hours') a where n<=200 order by exposed_at desc,screening_id limit 5000
  ) b;
 return jsonb_build_object('token',token,'asOf',now(),'samples',data);
end $$;

create function public.icash_finish_ranker_training(p_token uuid,p_result jsonb,p_elapsed_ms integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare model jsonb:=p_result->'model';metrics jsonb:=p_result->'metrics';status text:=p_result->>'status';item jsonb;
begin
 perform 1 from icash_ranker_private.settings where id=1 and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 if status is null or status not in ('collecting','rejected','qualified') or p_elapsed_ms is null or p_elapsed_ms not between 0 and 45000
  or octet_length(p_result::text)>10000 then raise exception 'Invalid model receipt';end if;
 if status='qualified' then
  if model->>'version' is distinct from 'property-logistic-v1' or coalesce(model->>'objective','') not in ('interest','contract','closing')
   or jsonb_typeof(model->'weights') is distinct from 'array' or jsonb_array_length(model->'weights')<>12
   or jsonb_typeof(model->'intercept') is distinct from 'number' or abs((model->>'intercept')::numeric)>30
   or jsonb_typeof(model->'rate') is distinct from 'number' or (model->>'rate')::numeric not between 0.000001 and 0.999999 then raise exception 'Invalid model';end if;
  for item in select value from jsonb_array_elements(model->'weights') loop
   if jsonb_typeof(item) is distinct from 'number' or abs(item::text::numeric)>30 then raise exception 'Invalid coefficient';end if;
  end loop;
  if not coalesce((metrics->>'train')::integer>=200 and (metrics->>'validation')::integer>=100
   and (metrics->>'trainPositive')::integer>=20 and (metrics->>'validationPositive')::integer>=10
   and (metrics->>'train')::integer-(metrics->>'trainPositive')::integer>=20
   and (metrics->>'validation')::integer-(metrics->>'validationPositive')::integer>=10
   and (metrics->>'trainAccounts')::integer>=3 and (metrics->>'validationAccounts')::integer>=3
   and (metrics->>'brier')::numeric between 0 and 1 and (metrics->>'baselineBrier')::numeric between 0 and 1
   and (metrics->>'auc')::numeric<=1 and (metrics->>'baselineAuc')::numeric between 0 and 1
   and (metrics->>'brier')::numeric<(metrics->>'baselineBrier')::numeric*0.95
   and (metrics->>'auc')::numeric>=0.6 and (metrics->>'auc')::numeric>=(metrics->>'baselineAuc')::numeric+0.03,false) then raise exception 'Unqualified model';end if;
 elsif model is distinct from 'null'::jsonb then raise exception 'Inactive receipt cannot contain a model';end if;
 insert into icash_ranker_private.runs(id,status,result,elapsed_ms) values(p_token,status,p_result,p_elapsed_ms);
 update icash_ranker_private.settings set active_model=case when status='qualified' then p_token end,
  lease_token=null,lease_until=null,last_trained_at=now() where id=1;
 return true;
end $$;

create function public.icash_ranker_report(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare report jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 select jsonb_build_object('enabled',s.enabled,'status',case when not s.enabled then 'disabled' when a.id is not null then 'qualified' when r.status='qualified' then 'expired' else coalesce(r.status,'collecting') end,
  'lastTrainedAt',s.last_trained_at,'elapsedMs',r.elapsed_ms,'reason',r.result->>'reason','metrics',coalesce(r.result->'metrics','{}'::jsonb),
  'samples',(select count(*) from icash_ranker_private.samples),'matureInterest',(select count(*) from icash_ranker_private.samples where interest is not null),
  'observedInterest',(select count(*) from icash_ranker_private.samples where interest=1),
  'observedContracts',(select count(*) from icash_ranker_private.samples where contract=1),
  'observedClosings',(select count(*) from icash_ranker_private.samples where closing=1),
  'cohorts',coalesce((select jsonb_agg(q) from (select cohort,count(*) as properties,count(*) filter(where exposed_at is not null) as contacted,
    count(*) filter(where contract is not null) as mature_contracts,count(*) filter(where contract=1) as contracts,
    count(*) filter(where closing is not null) as mature_closings,count(*) filter(where closing=1) as closings
   from icash_ranker_private.samples where model_id is not null group by cohort) q),'[]')) into report
 from icash_ranker_private.settings s left join icash_ranker_private.runs a on a.id=s.active_model and a.created_at>now()-interval '7 days'
 left join lateral(select * from icash_ranker_private.runs order by created_at desc limit 1) r on true where s.id=1;
 return report;
end $$;
alter function public.icash_platform_learning_report(uuid) rename to icash_platform_learning_before_ranker;
create function public.icash_platform_learning_report(p_actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_platform_learning_before_ranker(p_actor)||jsonb_build_object('ranker',public.icash_ranker_report(p_actor));
$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array['icash_ranker_features','icash_capture_ranker_sample','icash_opportunity_score',
 'icash_ranker_screened','icash_refresh_ranker_samples','icash_refresh_learning_account','icash_claim_ranker_training','icash_finish_ranker_training','icash_ranker_report','icash_platform_learning_report']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
