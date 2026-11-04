begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Bound all-age operator pages and hourly unresolved counts independently.
create index icash_support_backlog_page on public.icash_support_threads(created_at,id) where status in ('open','escalated','waiting_on_customer');
create index icash_access_backlog_page on public.icash_access_help_requests(created_at,id) where status in ('open','escalated','waiting_on_customer');
create index icash_support_stalled_review on public.icash_support_threads(updated_at,id) where status in ('open','escalated');
create index icash_access_stalled_review on public.icash_access_help_requests(updated_at,id) where status='open';
create index icash_support_message_review on public.icash_support_messages(thread_id,created_at desc,id desc);
create index icash_access_message_review on public.icash_access_help_messages(request_id,created_at desc,id desc);
do $$ begin
 if position('generation=version' in pg_get_functiondef('public.icash_refresh_shared_learning(integer)'::regprocedure))=0
  or position('pg_try_advisory_xact_lock' in pg_get_functiondef('public.icash_refresh_shared_learning(integer)'::regprocedure))=0 then
  raise exception 'Generation-safe learning refresh prerequisite changed';
 end if;
end $$;
create schema icash_learning_private;
revoke all on schema icash_learning_private from public,anon,authenticated;
grant usage on schema icash_learning_private to service_role;
create table icash_learning_private.refresh_runs(
 id bigint generated always as identity primary key,started_at timestamptz not null,completed_at timestamptz not null,
 refreshed integer not null,failed integer not null,due integer not null,conversion_attempted boolean not null,conversion_error text check(conversion_error ~ '^[0-9A-Z]{5}$')
);
create table icash_learning_private.components(
 component text primary key check(component in ('refresh','conversion','review')),
 last_attempt_at timestamptz,last_success_at timestamptz,last_error_at timestamptz,last_error_code text check(last_error_code ~ '^[0-9A-Z]{5}$')
);
alter table public.icash_learning_queue add column last_success_at timestamptz,add column last_attempt_at timestamptz,add column last_error_code text check(last_error_code ~ '^[0-9A-Z]{5}$');
update public.icash_learning_queue set last_success_at=last_refreshed_at;
create table icash_learning_private.improvement_proposals(
 id bigint generated always as identity primary key,category text not null,version integer not null default 1,
 status text not null default 'observed' check(status in ('observed','candidate','offline_validated','limited_experiment','promoted','rolled_back')),
 observations integer not null default 1,consecutive_observations integer not null default 1,
 first_observed_at timestamptz not null default now(),last_observed_at timestamptz not null default now(),
 last_reviewed_at timestamptz not null default now(),evidence jsonb not null,unique(category,version)
);
create table icash_learning_private.proposal_events(
 id bigint generated always as identity primary key,proposal_id bigint not null references icash_learning_private.improvement_proposals(id),
 created_at timestamptz not null default now(),status text not null,evidence jsonb not null
);
-- No customer prose or identities are stored in either report. Internal errors
-- retain SQLSTATE only; SQLERRM can contain contacts or source row contents.
do $$ declare t text;begin
 foreach t in array array['refresh_runs','components','improvement_proposals','proposal_events'] loop
  execute format('alter table icash_learning_private.%I enable row level security',t);
  execute format('revoke all on icash_learning_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
grant select,insert,update,delete on icash_learning_private.refresh_runs to service_role;
grant select,insert,update on icash_learning_private.components,icash_learning_private.improvement_proposals to service_role;
grant select,insert on icash_learning_private.proposal_events to service_role;
grant usage,select on all sequences in schema icash_learning_private to service_role;

create table icash_learning_private.validation_receipts(
 id uuid primary key,proposal_id bigint not null references icash_learning_private.improvement_proposals(id),proposal_version integer not null,
 stage text not null check(stage in ('offline_validated','limited_experiment','promoted','rolled_back')),
 release_sha text not null check(release_sha ~ '^[a-f0-9]{40}$'),policy_version text not null check(length(policy_version) between 1 and 100),
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),created_at timestamptz not null default now(),unique(proposal_id,proposal_version,stage,id)
);
alter table icash_learning_private.validation_receipts enable row level security;
revoke all on icash_learning_private.validation_receipts from public,anon,authenticated;
grant select on icash_learning_private.validation_receipts to service_role;
create unique index icash_validation_source_once on icash_learning_private.validation_receipts(proposal_id,proposal_version,stage,(receipt->>'sourceId'));

-- The release/decision registrar inserts immutable canonical receipts. This
-- transition never accepts a submitted claim as validation or business success.
create function public.icash_transition_improvement_proposal(p_proposal bigint,p_version integer,p_stage text,p_receipt uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p icash_learning_private.improvement_proposals;r icash_learning_private.validation_receipts;
begin
 select * into p from icash_learning_private.improvement_proposals where id=p_proposal for update;
 if not found or p.version is distinct from p_version then raise exception 'Proposal version changed';end if;
 select * into r from icash_learning_private.validation_receipts where id=p_receipt and proposal_id=p.id and proposal_version=p.version and stage=p_stage;
 if not found or r.created_at>now() or r.receipt->>'verified' is distinct from 'true' or coalesce(length(r.receipt->>'sourceId'),0) not between 1 and 200 then raise exception 'Verified receipt required';end if;
 if exists(select 1 from icash_learning_private.proposal_events where proposal_id=p.id and status=p_stage and evidence->>'receiptId'=p_receipt::text) then
  return jsonb_build_object('id',p.id::text,'status',p.status,'replayed',true);
 end if;
 if r.created_at<now()-interval '1 day' then raise exception 'Validation receipt expired';end if;
 if not coalesce(((p.status='candidate' and p_stage='offline_validated' and r.receipt->>'offlinePassed'='true' and r.receipt->>'source'='release_ci')
  or (p.status='offline_validated' and p_stage='limited_experiment' and r.receipt->>'limitedActive'='true' and r.receipt->>'source'='policy_decision')
  or (p.status='limited_experiment' and p_stage='promoted' and r.receipt->>'outcomePassed'='true' and r.receipt->>'source'='policy_decision')
  or (p.status in ('limited_experiment','promoted') and p_stage='rolled_back' and r.receipt->>'rollbackApplied'='true' and r.receipt->>'source'='policy_decision')),false) then
  raise exception 'Unsupported proposal transition';
 end if;
 if p_stage<>'offline_validated' and not exists(select 1 from icash_learning_private.proposal_events e join icash_learning_private.validation_receipts v on v.id::text=e.evidence->>'receiptId'
   where e.proposal_id=p.id and e.status='offline_validated' and v.release_sha=r.release_sha and v.policy_version=r.policy_version) then raise exception 'Validation lineage changed';end if;
 update icash_learning_private.improvement_proposals set status=p_stage,last_reviewed_at=now() where id=p.id;
 insert into icash_learning_private.proposal_events(proposal_id,status,evidence) values(p.id,p_stage,jsonb_build_object('receiptId',r.id,'releaseSha',r.release_sha,'policyVersion',r.policy_version,'source',r.receipt->>'source','sourceId',r.receipt->>'sourceId','businessSuccess',p_stage='promoted' and r.receipt->>'outcomePassed'='true'));
 return jsonb_build_object('id',p.id::text,'status',p_stage,'replayed',false);
end $$;

create function public.icash_learning_health() returns jsonb
language sql stable security invoker set search_path='' as $$
 with q as (select count(*) accounts,count(*) filter(where due_at<=now()) due,count(*) filter(where last_error_at is not null) failed,
 count(*) filter(where coalesce(last_success_at,last_refreshed_at)<now()-interval '6 hours') stale,
 count(*) filter(where coalesce(last_success_at,last_refreshed_at) is null) never,
 min(due_at) filter(where due_at<=now()) oldest_due,min(coalesce(last_success_at,last_refreshed_at)) oldest_success from public.icash_learning_queue),
 r as (select * from icash_learning_private.components where component='refresh'),
 c as (select * from icash_learning_private.components where component='conversion'),
 cache as (select updated_at from public.icash_learning_conversion_cache where id=1),
 health as (select q.*,
 exists(select 1 from r where last_attempt_at>now()-interval '2 minutes') fresh,
 ((not exists(select 1 from r where last_attempt_at>now()-interval '2 minutes'))::integer+
 (not exists(select 1 from cache where updated_at>now()-interval '15 minutes'))::integer+
 (q.failed>0)::integer+(q.stale>0 or q.never>0)::integer+
 coalesce((q.oldest_due<now()-interval '30 minutes')::integer,0)+
 (exists(select 1 from icash_learning_private.components where component='review' and last_error_at is not null))::integer) warnings from q)
 select jsonb_build_object('checkedAt',now(),'status',case when warnings>0 then 'degraded' else 'ok' end,'fresh',fresh,'warningCount',warnings,
 'queue',jsonb_build_object('accounts',accounts,'due',due,'failed',failed,'stale',stale,'neverRefreshed',never,'oldestDueAt',oldest_due,'oldestSuccessAt',oldest_success),
 'refresh',jsonb_build_object('lastAttemptAt',(select last_attempt_at from r),'lastSuccessAt',(select last_success_at from r),'lastErrorAt',(select last_error_at from r),'lastErrorCode',(select last_error_code from r)),
 'conversion',jsonb_build_object('lastAttemptAt',(select last_attempt_at from c),'lastSuccessAt',(select last_success_at from c),'lastErrorAt',(select last_error_at from c),'lastErrorCode',(select last_error_code from c),'updatedAt',(select updated_at from cache))) from health;
$$;

-- Root policy migrations may be applied after this additive operations schema.
create function public.icash_learning_policy_review_evidence() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare e jsonb;
begin
 if to_regclass('icash_learning_policy_private.decisions') is null then return null;end if;
 execute $q$select jsonb_build_object('source','canonical_policy_decision_v1','decisionId',id::text,'domain',domain,'context',context,'market',market,'policyVersion',policy_version,'decisionStatus',decision->>'status','businessSuccess',false)
 from icash_learning_policy_private.decisions where created_at between now()-interval '6 hours' and now() order by id desc limit 1$q$ into e;
 return e;
end $$;

-- A fixed, hourly review of saved operational evidence. No provider calls, text
-- generation, outreach, historical receipt changes or policy activation.
create function public.icash_review_learning_operations() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h jsonb;finding record;p icash_learning_private.improvement_proposals;v_count integer:=0;v_now timestamptz:=now();
begin
 if not pg_try_advisory_xact_lock(810241) then return jsonb_build_object('reviewed',false);end if;
 if exists(select 1 from icash_learning_private.components where component='review' and last_attempt_at>now()-interval '1 hour') then return jsonb_build_object('reviewed',false);end if;
 h:=public.icash_learning_health();
 for finding in
  with support as (
   select count(*) n from (select id from public.icash_support_threads where status in ('open','escalated') and updated_at<now()-interval '1 day' order by updated_at,id limit 1001) a
   union all select count(*) from (select id from public.icash_access_help_requests where status='open' and updated_at<now()-interval '1 day' order by updated_at,id limit 1001) b
  ), issues as (select s.report from icash_reliability_private.snapshots s where id=1 and checked_at>now()-interval '3 minutes')
  select 'learning_refresh'::text category,jsonb_build_object('source','learning_health_v1','warningCount',h->'warningCount','queue',h->'queue','businessSuccess',false) evidence where (h->>'warningCount')::integer>0
  union all select 'learning_policy',public.icash_learning_policy_review_evidence() where public.icash_learning_policy_review_evidence() is not null
  union all select 'support_stalled',jsonb_build_object('source','persisted_unresolved_status_v1','sampledStalled',sum(n),'limited',bool_or(n=1001),'businessSuccess',false) from support having sum(n)>0
  union all select 'workflow_'||(item->>'kind'),jsonb_build_object('source','fresh_workflow_snapshot_v1','sampledIssues',count(*),'limited',true,'businessSuccess',false)
   from issues cross join lateral jsonb_array_elements(coalesce(report->'issues','[]'::jsonb)) item
   where item->>'kind' in ('text_receipt','text_review','contract_delivery','contract_preparation','screening_lease','call_receipt','seller_response','buyer_fulfillment','owner_export') group by item->>'kind'
 loop
  select * into p from icash_learning_private.improvement_proposals where category=finding.category order by version desc limit 1 for update;
  if not found or (p.status in ('promoted','rolled_back') and exists(select 1 from icash_learning_private.proposal_events e where e.proposal_id=p.id and e.status=p.status and e.created_at<now()-interval '1 day')) then
   insert into icash_learning_private.improvement_proposals(category,version,evidence) values(finding.category,coalesce(p.version+1,1),finding.evidence) returning * into p;
   insert into icash_learning_private.proposal_events(proposal_id,status,evidence) values(p.id,'observed',finding.evidence);
  else
   update icash_learning_private.improvement_proposals set observations=observations+1,
    consecutive_observations=case when last_observed_at>=v_now-interval '2 hours' then consecutive_observations+1 else 1 end,
    last_observed_at=v_now,last_reviewed_at=v_now,evidence=finding.evidence where id=p.id returning * into p;
   if p.status='observed' and p.consecutive_observations>=3 and p.first_observed_at<=v_now-interval '2 hours' then
    update icash_learning_private.improvement_proposals set status='candidate' where id=p.id;
    insert into icash_learning_private.proposal_events(proposal_id,status,evidence) values(p.id,'candidate',finding.evidence||jsonb_build_object('reason','repeated_verified_operational_state','observations',p.observations));
   end if;
  end if;
  v_count:=v_count+1;
 end loop;
 insert into icash_learning_private.components(component,last_attempt_at,last_success_at) values('review',v_now,v_now)
 on conflict(component) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,last_error_at=null,last_error_code=null;
 return jsonb_build_object('reviewed',true,'categories',v_count);
end $$;

create function public.icash_learning_operations_report(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 return jsonb_build_object('lastReviewedAt',(select last_success_at from icash_learning_private.components where component='review'),
 'proposals',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'category',category,'version',version,'status',status,'observations',observations,'firstObservedAt',first_observed_at,'lastObservedAt',last_observed_at,'evidence',evidence) order by id desc) from (select * from icash_learning_private.improvement_proposals order by id desc limit 30) p),'[]'::jsonb));
end $$;

create or replace function public.icash_refresh_shared_learning(p_limit integer default 2) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;version bigint;refreshed integer:=0;failed integer:=0;attempted integer:=0;cache_attempt boolean:=false;cache_error text;last_code text;started timestamptz:=clock_timestamp();due integer;
begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Invalid learning batch';end if;
 if not exists(select 1 from public.icash_learning_conversion_cache where id=1 and updated_at>now()-interval '5 minutes') and pg_try_advisory_xact_lock(810211) then
  cache_attempt:=true;
  begin
   insert into public.icash_learning_conversion_cache(id,report) values(1,public.icash_usage_loop_report('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',false))
   on conflict(id) do update set report=excluded.report,updated_at=now();
  exception when others then cache_error:=sqlstate;failed:=failed+1;end;
 end if;
 -- Preserve outcome-before-queue lock order and generation-bound wakeups.
 for item in select account_id from public.icash_learning_queue where due_at<=now() order by due_at,account_id limit p_limit*5 loop
  exit when attempted>=p_limit;
  if not pg_try_advisory_xact_lock(hashtextextended(item.account_id::text,81021)) then continue;end if;
  select generation into version from public.icash_learning_queue where account_id=item.account_id and due_at<=now();
  if not found then continue;end if;
  attempted:=attempted+1;
  begin
   perform public.icash_refresh_learning_account(item.account_id);
   update public.icash_learning_queue set due_at=case when generation=version then now()+interval '1 hour' else due_at end,
    last_refreshed_at=case when generation=version then now() else last_refreshed_at end,last_success_at=now(),last_attempt_at=now(),last_error_at=null,last_error_code=null where account_id=item.account_id;
   refreshed:=refreshed+1;
  exception when others then
   last_code:=sqlstate;
   update public.icash_learning_queue set due_at=case when generation=version then now()+interval '5 minutes' else due_at end,last_attempt_at=now(),last_error_at=now(),last_error_code=last_code where account_id=item.account_id;
   failed:=failed+1;
  end;
 end loop;
 if cache_attempt then
  insert into icash_learning_private.components(component,last_attempt_at,last_success_at,last_error_at,last_error_code)
   values('conversion',now(),case when cache_error is null then now() end,case when cache_error is not null then now() end,cache_error)
   on conflict(component) do update set last_attempt_at=now(),last_success_at=coalesce(excluded.last_success_at,icash_learning_private.components.last_success_at),last_error_at=excluded.last_error_at,last_error_code=excluded.last_error_code;
 end if;
 insert into icash_learning_private.components(component,last_attempt_at,last_success_at,last_error_at,last_error_code)
 values('refresh',now(),case when failed=0 then now() end,case when failed>0 then now() end,coalesce(last_code,cache_error))
 on conflict(component) do update set last_attempt_at=now(),last_success_at=coalesce(excluded.last_success_at,icash_learning_private.components.last_success_at),last_error_at=excluded.last_error_at,last_error_code=excluded.last_error_code;
 begin
  perform public.icash_review_learning_operations();
 exception when others then
  insert into icash_learning_private.components(component,last_attempt_at,last_error_at,last_error_code) values('review',now(),now(),sqlstate)
  on conflict(component) do update set last_attempt_at=now(),last_error_at=now(),last_error_code=excluded.last_error_code;
 end;
 select count(*) into due from public.icash_learning_queue where due_at<=now();
 insert into icash_learning_private.refresh_runs(started_at,completed_at,refreshed,failed,due,conversion_attempted,conversion_error) values(started,clock_timestamp(),refreshed,failed,due,cache_attempt,cache_error);
 delete from icash_learning_private.refresh_runs where id in(select id from icash_learning_private.refresh_runs where completed_at<now()-interval '7 days' order by id limit 1000);
 return jsonb_build_object('refreshed',refreshed,'failed',failed,'due',due);
end $$;

alter function public.icash_refresh_account_work_snapshot() rename to icash_refresh_work_before_learning_health;
create function public.icash_refresh_account_work_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb;h jsonb;
begin
 r:=public.icash_refresh_work_before_learning_health();
 h:=public.icash_learning_health();
 r:=r||jsonb_build_object('learning',h,'issueCount',(r->>'issueCount')::integer-coalesce((r->'learning'->>'warningCount')::integer,0)+(h->>'warningCount')::integer);
 update icash_reliability_private.snapshots set report=r where id=1;
 return r;
end $$;
-- Keep the existing owner authorization and ranker report intact.
alter function public.icash_platform_learning_report(uuid) rename to icash_platform_learning_before_operations;
create function public.icash_platform_learning_report(p_actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_platform_learning_before_operations(p_actor)||jsonb_build_object('health',public.icash_learning_health(),'improvementReview',public.icash_learning_operations_report(p_actor));
$$;
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname=any(array['icash_learning_policy_review_evidence','icash_transition_improvement_proposal','icash_learning_health','icash_review_learning_operations','icash_learning_operations_report','icash_refresh_shared_learning','icash_refresh_account_work_snapshot','icash_refresh_work_before_learning_health','icash_platform_learning_report','icash_platform_learning_before_operations']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
