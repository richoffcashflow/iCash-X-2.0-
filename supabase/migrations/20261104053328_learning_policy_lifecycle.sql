begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Canonical release evidence is registered by the deployment operator only after
-- the exact main-push CI succeeds. No public RPC accepts a claimed CI result.
create table icash_learning_private.policy_releases(
 release_sha text primary key check(release_sha ~ '^[a-f0-9]{40}$'),
 ci_run_id bigint not null check(ci_run_id>0),ci_run_attempt integer not null check(ci_run_attempt>0),
 repository text not null check(repository='richoffcashflow/iCash-X-2.0-'),
 workflow text not null check(workflow='.github/workflows/reliability.yml'),
 branch text not null check(branch='main'),event text not null check(event='push'),
 conclusion text not null check(conclusion='success'),completed_at timestamptz not null,registered_at timestamptz not null default now(),
 unique(ci_run_id,ci_run_attempt)
);
create table icash_learning_private.policy_applications(
 id bigint generated always as identity primary key,decision_id bigint not null references icash_learning_policy_private.decisions(id),
 source text not null check(source in ('shared_assignment','seller_sms','shared_hold')),source_key text not null,
 release_sha text not null references icash_learning_private.policy_releases(release_sha),
 domain text not null,context text not null,market text not null,policy_version text not null,
 variant text not null,mode text not null check(mode in ('control','explore','shared','held')),created_at timestamptz not null default now(),unique(source,source_key)
);
create index policy_application_cohort on icash_learning_private.policy_applications(domain,context,market,policy_version,id desc);
create table icash_learning_private.policy_cohorts(
 domain text not null,context text not null,market text not null,policy_version text not null,
 latest_decision_id bigint not null references icash_learning_policy_private.decisions(id),latest_application_id bigint references icash_learning_private.policy_applications(id),
 last_reviewed_at timestamptz,last_error_at timestamptz,last_error_code text,primary key(domain,context,market,policy_version)
);
create index policy_cohort_review_due on icash_learning_private.policy_cohorts(last_reviewed_at nulls first,domain,context,market,policy_version);
alter table icash_learning_private.improvement_proposals add column cohort_key text not null default '',add column policy_domain text,add column policy_context text,add column policy_market text,add column policy_version text,add column release_sha text;
alter table icash_learning_private.improvement_proposals drop constraint improvement_proposals_category_version_key;
create unique index improvement_cohort_version on icash_learning_private.improvement_proposals(category,cohort_key,version);
-- Existing global rows remain historical; new observations never overwrite them.
update icash_learning_private.improvement_proposals set cohort_key='legacy-global' where category='learning_policy';
create function icash_learning_private.policy_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Canonical learning evidence is immutable';end $$;
create trigger policy_release_immutable before update or delete on icash_learning_private.policy_releases for each row execute function icash_learning_private.policy_immutable();
create trigger policy_application_immutable before update or delete on icash_learning_private.policy_applications for each row execute function icash_learning_private.policy_immutable();
create trigger policy_validation_immutable before update or delete on icash_learning_private.validation_receipts for each row execute function icash_learning_private.policy_immutable();

do $$ declare t text;begin
 foreach t in array array['policy_releases','policy_applications','policy_cohorts'] loop
  execute format('alter table icash_learning_private.%I enable row level security',t);
  execute format('revoke all on icash_learning_private.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on icash_learning_private.%I to service_role',t);
 end loop;
end $$;

create function icash_learning_private.observe_policy_decision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into icash_learning_private.policy_cohorts(domain,context,market,policy_version,latest_decision_id) values(new.domain,new.context,new.market,new.policy_version,new.id)
 on conflict(domain,context,market,policy_version) do update set latest_decision_id=greatest(icash_learning_private.policy_cohorts.latest_decision_id,excluded.latest_decision_id);
 return new;
end $$;
create trigger learning_decision_cohort after insert on icash_learning_policy_private.decisions for each row execute function icash_learning_private.observe_policy_decision();

create function icash_learning_private.expected_shared_allocation(p_account uuid,p_domain text,p_subject text,p_context text,p_decision jsonb,p_enabled boolean) returns jsonb
language plpgsql immutable set search_path='' as $$
declare allowed text[];choices text[];bucket bigint;group_bucket bigint;chosen text;selection text:='explore';winner text;
begin
 select array_agg(c order by n) into allowed from jsonb_array_elements_text(p_decision->'allowedChoices') with ordinality x(c,n);
 if coalesce(cardinality(allowed),0)=0 then return null;end if;
 group_bucket:=('x'||substr(md5(p_account::text||p_domain||p_context||'evidence-v2-control'),1,8))::bit(32)::bigint%100;
 bucket:=('x'||substr(md5(p_account::text||p_domain||p_subject||'evidence-v2'),1,8))::bit(32)::bigint%10000;
 chosen:=allowed[1+(bucket%cardinality(allowed))];
 if group_bucket<20 then selection:='control';
 elsif p_enabled and p_decision->>'status'='shared' then
  winner:=p_decision->>'winner';
  if bucket%5<3 then chosen:=winner;selection:='shared';
  else select array_agg(c order by n) into choices from unnest(allowed) with ordinality x(c,n) where c<>winner;chosen:=choices[1+(bucket%cardinality(choices))];end if;
 end if;
 return jsonb_build_object('variant',chosen,'mode',selection);
end $$;

create function icash_learning_private.record_policy_application() returns trigger
language plpgsql security definer set search_path='' as $$
declare d icash_learning_policy_private.decisions;s icash_learning_policy_private.settings;a bigint;src text;src_key text;expected jsonb;
begin
 if tg_op='UPDATE' then
  if old.learning_decision_id is not null and row(new.learning_decision_id,new.learning_policy_version,new.learning_selection_mode,new.variant) is distinct from row(old.learning_decision_id,old.learning_policy_version,old.learning_selection_mode,old.variant) then raise exception 'Learning allocation is immutable';end if;
  if old.learning_decision_id is null and new.learning_decision_id is not null then raise exception 'Historical allocation cannot be relabelled';end if;
  return new;
 end if;
 if new.learning_decision_id is null then return new;end if;
 select * into d from icash_learning_policy_private.decisions where id=new.learning_decision_id;
 if not found or new.learning_policy_version is distinct from d.policy_version or new.learning_selection_mode is null or new.learning_selection_mode not in ('control','explore','shared')
  or d.created_at not between now()-interval '6 hours' and now() or not (new.variant=any(d.choices))
  or (new.learning_selection_mode='shared' and (d.decision->>'status' is distinct from 'shared' or d.decision->>'winner' is distinct from new.variant)) then raise exception 'Allocation decision mismatch';end if;
 if d.stats is distinct from public.icash_shared_learning_stats(d.domain,d.context,d.market) then raise exception 'Allocation evidence changed';end if;
 select * into s from icash_learning_policy_private.settings where id=1;
 if tg_table_name='icash_learning_assignments' then
  if row(new.domain,new.context,new.market) is distinct from row(d.domain,d.context,d.market) then raise exception 'Allocation cohort mismatch';end if;
  expected:=icash_learning_private.expected_shared_allocation(new.account_id,new.domain,new.subject,new.context,d.decision,coalesce(s.enabled,false));
  if expected is null or expected->>'variant' is distinct from new.variant or expected->>'mode' is distinct from new.learning_selection_mode then raise exception 'Deterministic allocation mismatch';end if;
  src:='shared_assignment';src_key:=md5(jsonb_build_array(new.account_id,new.domain,new.subject)::text);
 else
  if d.domain<>'seller_sms' or d.context is distinct from new.learning_context or d.market<>'*' then raise exception 'Allocation cohort mismatch';end if;
  expected:=public.icash_seller_sms_learning_plan(new.account_id,new.thread_id);
  if expected is null or expected->>'variant' is distinct from new.variant or expected->>'mode' is distinct from new.learning_selection_mode or expected->>'body' is distinct from new.body or expected->'stats' is distinct from d.stats or expected->'decision' is distinct from d.decision then raise exception 'Seller SMS allocation mismatch';end if;
  src:='seller_sms';src_key:=new.thread_id::text;
 end if;
 select * into s from icash_learning_policy_private.settings where id=1;
 -- Disabled policy decisions may still be observed; activation is separate proof.
 if not coalesce(s.enabled,false) or s.release_sha is null or s.activated_at is null or s.activated_at>now() or s.policy_version<>d.policy_version then return new;end if;
 if d.created_at<s.evidence_after then raise exception 'Stale release decision';end if;
 if src='seller_sms' and not exists(select 1 from icash_learning_policy_private.sms_settings where id=1 and enabled) then return new;end if;
 if not exists(select 1 from icash_learning_private.policy_releases where release_sha=s.release_sha and completed_at<=s.activated_at and registered_at<=now()) then raise exception 'Verified policy release required';end if;
 insert into icash_learning_private.policy_applications(decision_id,source,source_key,release_sha,domain,context,market,policy_version,variant,mode)
 values(d.id,src,src_key,s.release_sha,d.domain,d.context,d.market,d.policy_version,new.variant,new.learning_selection_mode) returning id into a;
 update icash_learning_private.policy_cohorts set latest_application_id=a where (domain,context,market,policy_version)=(d.domain,d.context,d.market,d.policy_version);
 return new;
end $$;
create trigger shared_learning_application after insert or update on public.icash_learning_assignments for each row execute function icash_learning_private.record_policy_application();
create trigger seller_sms_learning_application after insert or update on public.icash_seller_opener_assignments for each row execute function icash_learning_private.record_policy_application();

create function public.icash_record_learning_policy_hold(p_decision bigint,p_account uuid,p_subject text) returns bigint
language plpgsql security definer set search_path='' as $$
declare d icash_learning_policy_private.decisions;s icash_learning_policy_private.settings;a bigint;k text;
begin
 select * into d from icash_learning_policy_private.decisions where id=p_decision;
 select * into s from icash_learning_policy_private.settings where id=1;
 if d.id is null or not coalesce(s.enabled,false) then return null;end if;
 if p_subject is null or length(p_subject) not between 1 and 200 or not exists(select 1 from public.icash_accounts where id=p_account)
  or d.domain not in ('seller_calls','buyer_search') or d.policy_version<>s.policy_version or d.created_at not between greatest(s.evidence_after,now()-interval '6 hours') and now()
  or d.decision->>'status' is distinct from 'safety_hold' or d.decision->'allowedChoices' is distinct from '[]'::jsonb
  or d.stats is distinct from public.icash_shared_learning_stats(d.domain,d.context,d.market)
  or not exists(select 1 from icash_learning_private.policy_releases where release_sha=s.release_sha and completed_at<=s.activated_at)
  or exists(select 1 from public.icash_learning_assignments where account_id=p_account and domain=d.domain and subject=p_subject) then raise exception 'Canonical policy hold required';end if;
 k:=md5(jsonb_build_array(p_account,d.domain,p_subject,d.id)::text);
 insert into icash_learning_private.policy_applications(decision_id,source,source_key,release_sha,domain,context,market,policy_version,variant,mode)
 values(d.id,'shared_hold',k,s.release_sha,d.domain,d.context,d.market,d.policy_version,'','held') on conflict(source,source_key) do nothing returning id into a;
 if a is null then select id into a from icash_learning_private.policy_applications where source='shared_hold' and source_key=k;end if;
 update icash_learning_private.policy_cohorts set latest_application_id=greatest(coalesce(latest_application_id,0),a) where (domain,context,market,policy_version)=(d.domain,d.context,d.market,d.policy_version);
 return a;
end $$;

create function public.icash_activate_learning_policy(p_actor uuid,p_release_sha text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r icash_learning_private.policy_releases;s icash_learning_policy_private.settings;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid or p_enabled is null then raise exception 'Owner required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into s from icash_learning_policy_private.settings where id=1 for update;
 if not found then raise exception 'Learning settings missing';end if;
 if not p_enabled then
  update icash_learning_policy_private.settings set enabled=false where id=1;
  update icash_learning_policy_private.sms_settings set enabled=false where id=1;
  return jsonb_build_object('enabled',false);
 end if;
 select * into r from icash_learning_private.policy_releases where release_sha=p_release_sha and completed_at<=now() and registered_at<=now();
 if not found then raise exception 'Canonical successful release required';end if;
 if s.evidence_after<r.completed_at then raise exception 'Release evidence invalidation required';end if;
 if s.enabled and s.release_sha is distinct from p_release_sha then raise exception 'Pause before changing policy release';end if;
 update icash_learning_policy_private.settings set enabled=true,release_sha=p_release_sha,activated_at=case when enabled and release_sha=p_release_sha then activated_at else now() end where id=1;
 update icash_learning_policy_private.sms_settings set enabled=true where id=1;
 return jsonb_build_object('enabled',true,'releaseSha',p_release_sha);
end $$;

-- Private registrar: each stage is derived from canonical records, never a
-- supplied verified flag. Caller chooses only the exact proposal to evaluate.
create function public.icash_advance_policy_proposal(p_proposal bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p icash_learning_private.improvement_proposals;s icash_learning_policy_private.settings;r icash_learning_private.policy_releases;
 a icash_learning_private.policy_applications;fallback icash_learning_private.policy_applications;d icash_learning_policy_private.decisions;v_stage text;proof jsonb;rid uuid;source_id text;validated_sha text;
begin
 select * into p from icash_learning_private.improvement_proposals where id=p_proposal for update;
 if not found or p.category<>'learning_policy' or p.cohort_key in ('','legacy-global') then raise exception 'Policy cohort required';end if;
 select * into s from icash_learning_policy_private.settings where id=1;
 select * into r from icash_learning_private.policy_releases where release_sha=s.release_sha and completed_at<=now() and registered_at<=now();
 if not found or p.policy_version is distinct from s.policy_version or p.release_sha is distinct from r.release_sha then return jsonb_build_object('advanced',false,'reason','verified_release_required');end if;
 select * into a from icash_learning_private.policy_applications where (domain,context,market,policy_version)=(p.policy_domain,p.policy_context,p.policy_market,p.policy_version) and release_sha=r.release_sha order by id desc limit 1;
 if p.status in ('limited_experiment','promoted') then
  select candidate.* into fallback from icash_learning_private.policy_applications candidate join icash_learning_policy_private.decisions cd on cd.id=candidate.decision_id
   where (candidate.domain,candidate.context,candidate.market,candidate.policy_version,candidate.release_sha)=(p.policy_domain,p.policy_context,p.policy_market,p.policy_version,r.release_sha)
   and candidate.created_at>now()-interval '6 hours' and candidate.mode in ('explore','held') and cd.decision->>'status' in ('explore','safety_hold')
   and exists(select 1 from icash_learning_private.policy_applications prior where (prior.domain,prior.context,prior.market,prior.policy_version,prior.release_sha)=(candidate.domain,candidate.context,candidate.market,candidate.policy_version,candidate.release_sha) and prior.id<candidate.id and prior.mode='shared')
   and not exists(select 1 from icash_learning_private.policy_applications later where (later.domain,later.context,later.market,later.policy_version,later.release_sha)=(candidate.domain,candidate.context,candidate.market,candidate.policy_version,candidate.release_sha) and later.id>candidate.id and later.mode='shared')
   order by candidate.id desc limit 1;
  if fallback.id is not null then a:=fallback;end if;
 end if;
 if a.id is not null then select * into d from icash_learning_policy_private.decisions where id=a.decision_id;end if;
 if p.status='candidate' then
  v_stage:='offline_validated';source_id:='ci:'||r.ci_run_id||':'||r.ci_run_attempt;
  proof:=jsonb_build_object('source','release_ci','offlinePassed',true);
 elsif p.status='offline_validated' and s.enabled and s.activated_at between r.completed_at and now() and a.created_at>=s.activated_at
  and (p.policy_domain<>'seller_sms' or exists(select 1 from icash_learning_policy_private.sms_settings where id=1 and enabled)) then
  v_stage:='limited_experiment';source_id:='application:'||a.id;
  proof:=jsonb_build_object('source','policy_decision','limitedActive',true);
 elsif p.status='limited_experiment' and s.activated_at<=now()-interval '72 hours' and a.decision_id=(select latest_decision_id from icash_learning_private.policy_cohorts where (domain,context,market,policy_version)=(p.policy_domain,p.policy_context,p.policy_market,p.policy_version)) and a.created_at>now()-interval '6 hours' and a.mode='shared' and d.decision->>'status'='shared'
  and s.enabled and s.activated_at<=a.created_at then
  v_stage:='promoted';source_id:='application:'||a.id;
  proof:=jsonb_build_object('source','policy_decision','outcomePassed',true,'objective',d.decision->>'objective','reason',d.decision->>'reason');
 elsif p.status in ('limited_experiment','promoted') and a.created_at>now()-interval '6 hours' and a.mode in ('explore','held') and d.decision->>'status' in ('explore','safety_hold')
  and exists(select 1 from icash_learning_private.policy_applications prior join icash_learning_policy_private.decisions prior_d on prior_d.id=prior.decision_id
   where (prior.domain,prior.context,prior.market,prior.policy_version,prior.release_sha)=(a.domain,a.context,a.market,a.policy_version,a.release_sha)
   and prior.id<a.id and prior.mode='shared' and prior_d.decision->>'status'='shared') then
  v_stage:='rolled_back';source_id:='application:'||a.id;
  proof:=jsonb_build_object('source','policy_decision','rollbackApplied',true,'reason',d.decision->>'reason');
 else return jsonb_build_object('advanced',false,'reason','stage_evidence_required');end if;
 select id into rid from icash_learning_private.validation_receipts where proposal_id=p.id and proposal_version=p.version and validation_receipts.stage=v_stage and receipt->>'sourceId'=source_id;
 if rid is null then
  rid:=gen_random_uuid();
  insert into icash_learning_private.validation_receipts(id,proposal_id,proposal_version,stage,release_sha,policy_version,receipt)
  values(rid,p.id,p.version,v_stage,r.release_sha,p.policy_version,proof||jsonb_build_object('verified',true,'sourceId',source_id,'releaseSha',r.release_sha,'policyVersion',p.policy_version,'domain',p.policy_domain,'context',p.policy_context,'market',p.policy_market,'decisionId',d.id,'applicationId',a.id));
 end if;
 return public.icash_transition_improvement_proposal(p.id,p.version,v_stage,rid);
end $$;

-- Remove the old latest-global observation. Fixed operation categories continue
-- in their existing bounded review; policy cohorts have an independent cursor.
create or replace function public.icash_learning_policy_review_evidence() returns jsonb language sql stable set search_path='' as $$select null::jsonb$$;
create function public.icash_review_policy_cohorts() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record;p icash_learning_private.improvement_proposals;k text;e jsonb;n integer:=0;i integer;errors integer:=0;current_release text;
begin
 select release_sha into current_release from icash_learning_policy_private.settings where id=1;
 if not pg_try_advisory_xact_lock(810242) then return jsonb_build_object('reviewed',0);end if;
 for c in select x.*,d.created_at decision_at,d.decision from icash_learning_private.policy_cohorts x join icash_learning_policy_private.decisions d on d.id=x.latest_decision_id
  where (x.last_reviewed_at is null or x.last_reviewed_at<=now()-interval '1 hour') and d.created_at>=now()-interval '6 hours'
  order by x.last_reviewed_at nulls first,x.domain,x.context,x.market,x.policy_version limit 20 for update of x skip locked
 loop
 begin
  k:=md5(jsonb_build_array(c.domain,c.context,c.market,c.policy_version)::text);
  e:=jsonb_build_object('source','canonical_policy_cohort_v1','domain',c.domain,'context',c.context,'market',c.market,'policyVersion',c.policy_version,'decisionId',c.latest_decision_id::text,'applicationId',c.latest_application_id::text,'decisionStatus',c.decision->>'status','businessSuccess',false);
  select * into p from icash_learning_private.improvement_proposals where category='learning_policy' and cohort_key=k order by version desc limit 1 for update;
  if not found or p.release_sha is distinct from current_release then
   insert into icash_learning_private.improvement_proposals(category,cohort_key,version,policy_domain,policy_context,policy_market,policy_version,release_sha,evidence)
   values('learning_policy',k,coalesce(p.version+1,1),c.domain,c.context,c.market,c.policy_version,current_release,e) returning * into p;
   insert into icash_learning_private.proposal_events(proposal_id,status,evidence) values(p.id,'observed',e);
  else
   update icash_learning_private.improvement_proposals set observations=observations+1,consecutive_observations=case when last_observed_at>=now()-interval '2 hours' then consecutive_observations+1 else 1 end,last_observed_at=now(),last_reviewed_at=now(),evidence=e where id=p.id returning * into p;
   if p.status='observed' and p.consecutive_observations>=3 and p.first_observed_at<=now()-interval '2 hours' then
    update icash_learning_private.improvement_proposals set status='candidate' where id=p.id;
    insert into icash_learning_private.proposal_events(proposal_id,status,evidence) values(p.id,'candidate',e);
   end if;
  end if;
  -- Maximum four individually verified steps, never skip a missing prerequisite.
  for i in 1..4 loop perform public.icash_advance_policy_proposal(p.id);end loop;
  update icash_learning_private.policy_cohorts set last_reviewed_at=now(),last_error_at=null,last_error_code=null where (domain,context,market,policy_version)=(c.domain,c.context,c.market,c.policy_version);
  n:=n+1;
 exception when others then
  update icash_learning_private.policy_cohorts set last_reviewed_at=now(),last_error_at=now(),last_error_code=sqlstate where (domain,context,market,policy_version)=(c.domain,c.context,c.market,c.policy_version);
  errors:=errors+1;
 end;
 end loop;
 return jsonb_build_object('reviewed',n,'errors',errors);
end $$;
alter function public.icash_review_learning_operations() rename to icash_review_operations_before_cohorts;
create function public.icash_review_learning_operations() returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;b jsonb;begin a:=public.icash_review_operations_before_cohorts();b:=public.icash_review_policy_cohorts();if (b->>'errors')::integer>0 then update icash_learning_private.components set last_error_at=now(),last_error_code='P0001' where component='review';end if;return a||jsonb_build_object('policyCohorts',b);end $$;
revoke all on function icash_learning_private.expected_shared_allocation(uuid,text,text,text,jsonb,boolean),icash_learning_private.policy_immutable(),icash_learning_private.observe_policy_decision(),icash_learning_private.record_policy_application(),public.icash_record_learning_policy_hold(bigint,uuid,text),public.icash_activate_learning_policy(uuid,text,boolean),public.icash_advance_policy_proposal(bigint),public.icash_review_policy_cohorts(),public.icash_review_operations_before_cohorts(),public.icash_review_learning_operations(),public.icash_learning_policy_review_evidence() from public,anon,authenticated;
grant execute on function public.icash_record_learning_policy_hold(bigint,uuid,text),public.icash_activate_learning_policy(uuid,text,boolean),public.icash_advance_policy_proposal(bigint),public.icash_review_policy_cohorts(),public.icash_review_operations_before_cohorts(),public.icash_review_learning_operations() to service_role;
do $$ declare d text;needle text:=$n$'businessSuccess',p_stage='promoted' and r.receipt->>'outcomePassed'='true'$n$;begin
 d:=pg_get_functiondef('public.icash_transition_improvement_proposal(bigint,integer,text,uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'Proposal transition evidence changed';end if;
 execute replace(d,needle,$n$'businessSuccess',false,'allocationApplied',p_stage='promoted' and r.receipt->>'outcomePassed'='true'$n$);
end $$;
commit;
