begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- New evidence is prospective. Existing assignment identities and receipts stay immutable.
create schema icash_learning_policy_private;
revoke all on schema icash_learning_policy_private from public,anon,authenticated;
grant usage on schema icash_learning_policy_private to service_role;
create table icash_learning_policy_private.settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 policy_version text not null default 'evidence-v2' check(policy_version='evidence-v2'),
 release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),activated_at timestamptz,
 evidence_after timestamptz not null default now(),
 check(not enabled or (release_sha is not null and activated_at is not null))
);
insert into icash_learning_policy_private.settings(id) values(1);
create table icash_learning_policy_private.decisions(
 id bigint generated always as identity primary key,domain text not null,context text not null,market text not null,
 policy_version text not null check(policy_version='evidence-v2'),decision jsonb not null,stats jsonb not null,
 choices text[] not null,require_contracts boolean not null,evidence_hash text not null,
 created_at timestamptz not null default now(),
 unique(domain,context,market,policy_version,evidence_hash)
);
create index icash_learning_decision_cohort on icash_learning_policy_private.decisions(domain,context,market,id desc);
alter table icash_learning_policy_private.settings enable row level security;
alter table icash_learning_policy_private.decisions enable row level security;
revoke all on icash_learning_policy_private.settings,icash_learning_policy_private.decisions from public,anon,authenticated;
grant select on icash_learning_policy_private.settings,icash_learning_policy_private.decisions to service_role;
alter table public.icash_learning_assignments
 add column learning_decision_id bigint references icash_learning_policy_private.decisions(id),
 add column learning_policy_version text check(learning_policy_version='evidence-v2'),
 add column learning_selection_mode text check(learning_selection_mode in ('control','explore','shared')),
 add constraint icash_assignment_learning_evidence check(
  (learning_decision_id is null and learning_policy_version is null and learning_selection_mode is null)
  or (learning_decision_id is not null and learning_policy_version is not null and learning_selection_mode is not null));

-- Pure SQL/TypeScript parity boundary. These are uncertainty bounds for observed
-- reviewed alternatives, not a causal lift estimate or a total-profit metric.
create function public.icash_learning_bounds_v2(p_wins numeric,p_trials numeric) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare p numeric;z numeric:=1.96;center numeric;spread numeric;scale numeric;
begin
 if p_wins is null or p_trials is null or p_wins::text in ('NaN','Infinity','-Infinity') or p_trials::text in ('NaN','Infinity','-Infinity') or p_trials<=0 or p_wins<0 or p_wins>p_trials then return '{"lower":0,"upper":1}'::jsonb;end if;
 p:=p_wins/p_trials;center:=p+z*z/(2*p_trials);spread:=z*sqrt(p*(1-p)/p_trials+z*z/(4*p_trials*p_trials));scale:=1+z*z/p_trials;
 return jsonb_build_object('lower',greatest(0,(center-spread)/scale),'upper',least(1,(center+spread)/scale));
end $$;
create function public.icash_learning_decision_v2(p_stats jsonb,p_choices text[],p_require_contracts boolean default false) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:=jsonb_build_object('policyVersion','evidence-v2','status','explore','winner',null,'objective','positive','reason','insufficient_evidence','allowedChoices',coalesce(to_jsonb(p_choices),'[]'));
 s jsonb;k text;v numeric;stats jsonb;allowed text[];objective text:='positive';trials numeric;wins numeric;b jsonb;
 lower_yield numeric;upper_yield numeric;ranked jsonb:='[]';best jsonb;
 integers text[]:=array['contributors','attempts','pending','positive','opted_out','contract_trials','contracts','closing_trials','closings','cost_cents'];
 numbers text[]:=array['effective_attempts','effective_pending','effective_positive','effective_opted_out','effective_contract_trials','effective_contracts','effective_closing_trials','effective_closings','effective_cost_cents'];
begin
 if coalesce(cardinality(p_choices),0) not between 1 and 20 or array_ndims(p_choices)<>1
  or (select count(distinct c) from unnest(p_choices)c)<>cardinality(p_choices)
  or exists(select 1 from unnest(p_choices)c where c is null or length(c) not between 1 and 100) then
  return result||'{"reason":"invalid_choices","allowedChoices":[]}'::jsonb;
 end if;
 if jsonb_typeof(p_stats) is distinct from 'array' then return result;end if;
 if jsonb_array_length(p_stats) not between 1 and 100 then return result;end if;
 if (select count(distinct r->>'variant') from jsonb_array_elements(p_stats)r)<>jsonb_array_length(p_stats) then return result;end if;
 for s in select value from jsonb_array_elements(p_stats) loop
  if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'variant') is distinct from 'string' or length(s->>'variant') not between 1 and 100
   or jsonb_typeof(s->'costs_complete') is distinct from 'boolean' or jsonb_typeof(s->'updated_at') is distinct from 'string' then return result;end if;
  foreach k in array integers||numbers loop
   if jsonb_typeof(s->k) is distinct from 'number' then return result;end if;
   v:=(s->>k)::numeric;
   if v<0 or v>9007199254740991 or (k=any(integers) and trunc(v)<>v) then return result;end if;
  end loop;
  if (s->>'pending')::numeric>(s->>'attempts')::numeric or (s->>'positive')::numeric>(s->>'attempts')::numeric-(s->>'pending')::numeric or (s->>'opted_out')::numeric>(s->>'attempts')::numeric
   or (s->>'contracts')::numeric>(s->>'contract_trials')::numeric or (s->>'closings')::numeric>(s->>'closing_trials')::numeric
   or (s->>'effective_pending')::numeric>(s->>'effective_attempts')::numeric or (s->>'effective_positive')::numeric>(s->>'effective_attempts')::numeric-(s->>'effective_pending')::numeric or (s->>'effective_opted_out')::numeric>(s->>'effective_attempts')::numeric
   or (s->>'effective_contracts')::numeric>(s->>'effective_contract_trials')::numeric or (s->>'effective_closings')::numeric>(s->>'effective_closing_trials')::numeric then return result;end if;
 end loop;
 select coalesce(jsonb_agg(r),'[]') into stats from jsonb_array_elements(p_stats)r where r->>'variant'=any(p_choices);
 select coalesce(array_agg(c order by n),array[]::text[]) into allowed from unnest(p_choices) with ordinality x(c,n)
 where not exists(select 1 from jsonb_array_elements(stats)r where r->>'variant'=c and (r->>'effective_attempts')::numeric>=20
  and (r->>'effective_opted_out')::numeric>=3 and (r->>'effective_opted_out')::numeric/(r->>'effective_attempts')::numeric>0.05);
 result:=result||jsonb_build_object('allowedChoices',to_jsonb(allowed));
 if cardinality(allowed)<>cardinality(p_choices) then return result||'{"status":"safety_hold","reason":"opt_out_guard"}'::jsonb;end if;
 if cardinality(p_choices)<2 then return result;end if;
 if jsonb_array_length(stats)<>cardinality(p_choices) or exists(select 1 from jsonb_array_elements(stats)r where (r->>'contributors')::numeric<3
  or (r->>'effective_attempts')::numeric-(r->>'effective_pending')::numeric<100
  or (r->>'effective_opted_out')::numeric/greatest(1,(r->>'effective_attempts')::numeric)>0.05) then return result;end if;
 if (select bool_and((r->>'effective_closing_trials')::numeric>=100) from jsonb_array_elements(stats)r) then objective:='closings';
 elsif (select bool_and((r->>'effective_contract_trials')::numeric>=100) from jsonb_array_elements(stats)r) then objective:='contracts';end if;
 result:=result||jsonb_build_object('objective',objective);
 if p_require_contracts and objective='positive' then return result||'{"reason":"verified_contracts_required"}'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(stats)r where not (r->>'costs_complete')::boolean or (r->>'effective_cost_cents')::numeric<=0) then
  return result||'{"reason":"cost_evidence_incomplete"}'::jsonb;end if;
 for s in select value from jsonb_array_elements(stats) loop
  trials:=case objective when 'closings' then (s->>'effective_closing_trials')::numeric when 'contracts' then (s->>'effective_contract_trials')::numeric else (s->>'effective_attempts')::numeric-(s->>'effective_pending')::numeric end;
  wins:=(s->>('effective_'||objective))::numeric;b:=public.icash_learning_bounds_v2(wins,trials);
  lower_yield:=greatest(0,(b->>'lower')::numeric*trials-0.5*(s->>'effective_opted_out')::numeric)/(s->>'effective_cost_cents')::numeric;
  upper_yield:=(b->>'upper')::numeric*trials/(s->>'effective_cost_cents')::numeric;
  ranked:=ranked||jsonb_build_array(jsonb_build_object('variant',s->>'variant','wins',wins,'lower',lower_yield,'upper',upper_yield));
 end loop;
 select r into best from jsonb_array_elements(ranked)r order by (r->>'lower')::numeric desc,r->>'variant' collate "C" limit 1;
 if (best->>'wins')::numeric<(case when objective='positive' then 10 else 5 end) then return result||'{"reason":"insufficient_positive_outcomes"}'::jsonb;end if;
 if (best->>'lower')::numeric<=0 or exists(select 1 from jsonb_array_elements(ranked)r where r->>'variant'<>best->>'variant' and (best->>'lower')::numeric<=(r->>'upper')::numeric*1.05) then
  return result||'{"reason":"comparison_inconclusive"}'::jsonb;end if;
 return result||jsonb_build_object('status','shared','winner',best->>'variant','reason','verified_cost_comparison');
end $$;

create function public.icash_record_learning_decision(p_domain text,p_context text,p_market text,p_stats jsonb,p_choices text[],p_require_contracts boolean default false) returns bigint
language plpgsql security definer set search_path='' as $$
declare result bigint;computed jsonb;fingerprint text;canonical jsonb;epoch timestamptz;release text;
begin
 if length(p_domain) not between 1 and 100 or length(p_context) not between 1 and 100 or length(p_market) not between 1 and 100
  or p_domain is null or p_context is null or p_market is null or p_stats is null or octet_length(p_stats::text)>262144 then raise exception 'Invalid learning evidence';end if;
 if p_require_contracts is distinct from false or not coalesce(
  (p_domain='seller_calls' and p_context in ('reviewed','limited') and p_market='*' and p_choices=array['cash_interest','flexible_timing'])
  or (p_domain='buyer_search' and p_context='order-v1' and p_market ~ '^[0-9]{5}$' and p_choices=array['recent_corporate','corporate_owners'])
  or (p_domain='seller_sms' and p_context='identity-v5' and p_market='*' and cardinality(p_choices)>0
   and p_choices<@array['identity_cash_v5','identity_as_is_v5','identity_timing_v5']),false) then raise exception 'Unreviewed learning evidence scope';end if;
 select evidence_after,release_sha into epoch,release from icash_learning_policy_private.settings where id=1;
 canonical:=public.icash_shared_learning_stats(p_domain,p_context,p_market);
 if p_stats is distinct from canonical then raise exception 'Learning evidence does not match canonical observations';end if;
 computed:=public.icash_learning_decision_v2(canonical,p_choices,p_require_contracts);
 if computed->>'reason'='invalid_choices' then raise exception 'Invalid learning choices';end if;
 fingerprint:=md5(jsonb_build_object('stats',p_stats,'choices',p_choices,'requireContracts',p_require_contracts,'decision',computed,'snapshotHour',date_trunc('hour',now()),'evidenceEpoch',epoch,'releaseSha',release)::text);
 insert into icash_learning_policy_private.decisions(domain,context,market,policy_version,decision,stats,choices,require_contracts,evidence_hash)
 values(p_domain,p_context,p_market,'evidence-v2',computed,p_stats,p_choices,p_require_contracts,fingerprint)
 on conflict(domain,context,market,policy_version,evidence_hash) do nothing returning id into result;
 if result is null then select id into result from icash_learning_policy_private.decisions where domain=p_domain and context=p_context and market=p_market and policy_version='evidence-v2' and evidence_hash=fingerprint;end if;
 return result;
end $$;

-- Patching only the reviewed live implementations makes prerequisite drift fail closed.
do $$ begin
 if md5(pg_get_functiondef('public.icash_shared_learning_stats(text,text,text)'::regprocedure))<>'3ef85b85a29567ba7cabf40716284308'
  or md5(pg_get_functiondef('public.icash_shared_learning_winner(text,text,text,text[])'::regprocedure))<>'4c27a7d76a408d35915376db93d66573'
  or md5(pg_get_functiondef('public.icash_assign_shared_learning(uuid,text,text,text,text)'::regprocedure))<>'10eeafbba98714db7509f2624abd2eaa' then raise exception 'Shared learning prerequisite changed';end if;
end $$;

CREATE OR REPLACE FUNCTION public.icash_shared_learning_stats(p_domain text, p_context text, p_market text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 -- Unknown-owner, canonical owner/demo and test-only accounts cannot teach peers.
 with samples as (select r.*,least(1,200.0/greatest(r.attempts,r.contract_trials,r.closing_trials,1)) weight
 from public.icash_learning_rollups r join public.icash_accounts a on a.id=r.account_id
 where r.domain=p_domain and r.context=p_context and r.market=p_market and r.updated_at>now()-interval '6 hours'
  and r.updated_at>=(select evidence_after from icash_learning_policy_private.settings where id=1)
  and a.owner_user_id is not null and a.owner_user_id<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
   or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))),
 stats as (select variant,count(*) filter(where attempts>0) contributors,sum(attempts) attempts,sum(pending) pending,sum(positive) positive,sum(opted_out) opted_out,
 sum(contract_trials) contract_trials,sum(contracts) contracts,sum(closing_trials) closing_trials,sum(closings) closings,sum(cost_cents) cost_cents,
 -- These legacy readers cover only first call/search/recovery charges. Keep
 -- their historical sums visible, but never certify them as complete yield cost.
 bool_and(costs_complete) and p_domain not in ('seller_calls','buyer_search','seller_recovery') costs_complete,min(updated_at) updated_at,
 sum(attempts*weight) effective_attempts,sum(pending*weight) effective_pending,sum(positive*weight) effective_positive,sum(opted_out*weight) effective_opted_out,
 sum(contract_trials*weight) effective_contract_trials,sum(contracts*weight) effective_contracts,sum(closing_trials*weight) effective_closing_trials,sum(closings*weight) effective_closings,sum(cost_cents*weight) effective_cost_cents from samples group by variant)
 select coalesce(jsonb_agg(to_jsonb(stats) order by variant),'[]') from stats;
$function$;

CREATE OR REPLACE FUNCTION public.icash_shared_learning_winner(p_domain text,p_context text,p_market text,p_choices text[]) returns text
language plpgsql stable security invoker set search_path='' as $$
declare decision jsonb;
begin
 if not coalesce((select enabled from icash_learning_policy_private.settings where id=1),false) then return null;end if;
 decision:=public.icash_learning_decision_v2(public.icash_shared_learning_stats(p_domain,p_context,p_market),p_choices,p_domain='seller_recovery');
 return case when decision->>'status'='shared' then decision->>'winner' end;
end $$;
CREATE OR REPLACE FUNCTION public.icash_assign_shared_learning(p_account uuid,p_domain text,p_subject text,p_context text,p_market text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.icash_learning_assignments;choices text[];allowed text[];winner text;bucket bigint;group_bucket bigint;chosen text;
 mode text:='explore';selection text:='explore';decision_id bigint;decision jsonb;enabled boolean;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account) or length(p_subject) not between 1 and 200 then return null;end if;
 if p_domain='seller_calls' and p_context in ('reviewed','limited') and p_market='*' then choices:=array['cash_interest','flexible_timing'];
 elsif p_domain='buyer_search' and p_context='order-v1' and p_market ~ '^[0-9]{5}$' then choices:=array['recent_corporate','corporate_owners'];
 else raise exception 'Unreviewed learning policy';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||p_domain||p_subject,81022));
 select * into existing from public.icash_learning_assignments where account_id=p_account and domain=p_domain and subject=p_subject;
 if found then
  if existing.context<>p_context or existing.market<>p_market then return null;end if;
  return jsonb_build_object('variant',existing.variant,'version',existing.policy_version,'mode',existing.mode);end if;
 if p_domain='seller_calls' and exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id::text=split_part(p_subject,':',1)) then return null;end if;
 if p_domain='buyer_search' and exists(select 1 from public.icash_buyer_search_receipts r join public.icash_deal_files d on d.id=r.deal_id where d.account_id=p_account and d.id::text||':'||r.revision=p_subject) then return null;end if;
 decision_id:=public.icash_record_learning_decision(p_domain,p_context,p_market,public.icash_shared_learning_stats(p_domain,p_context,p_market),choices,false);
 select d.decision into decision from icash_learning_policy_private.decisions d where d.id=decision_id;
 select coalesce(array_agg(c order by n),array[]::text[]) into allowed from jsonb_array_elements_text(decision->'allowedChoices') with ordinality x(c,n);
 if cardinality(allowed)=0 then
  if to_regprocedure('public.icash_record_learning_policy_hold(bigint,uuid,text)') is not null then
   perform public.icash_record_learning_policy_hold(decision_id,p_account,p_subject);
  end if;
  return jsonb_build_object('held',true,'reason','learning_safety_hold');
 end if;
 enabled:=coalesce((select s.enabled from icash_learning_policy_private.settings s where id=1),false);
 -- A stable account control cohort enables comparison without transferring any
 -- peer cursors, contacts, permissions or financial authority.
 group_bucket:=('x'||substr(md5(p_account::text||p_domain||p_context||'evidence-v2-control'),1,8))::bit(32)::bigint%100;
 bucket:=('x'||substr(md5(p_account::text||p_domain||p_subject||'evidence-v2'),1,8))::bit(32)::bigint%10000;
 chosen:=allowed[1+(bucket%cardinality(allowed))];
 if group_bucket<20 then selection:='control';
 elsif enabled and decision->>'status'='shared' then
  winner:=decision->>'winner';
  if bucket%5<3 then chosen:=winner;mode:='shared';selection:='shared';
  else
   select array_agg(c order by n) into choices from unnest(allowed) with ordinality x(c,n) where c<>winner;
   chosen:=choices[1+(bucket%cardinality(choices))];
  end if;
 end if;
 insert into public.icash_learning_assignments(account_id,domain,subject,context,market,variant,mode,learning_decision_id,learning_policy_version,learning_selection_mode)
 values(p_account,p_domain,p_subject,p_context,p_market,chosen,mode,decision_id,'evidence-v2',selection);
 return jsonb_build_object('variant',chosen,'version','shared-v1','mode',mode);
end $$;
-- No service path deletes allocation history; prevent erasure followed by reallocation.
revoke delete,truncate on public.icash_learning_assignments from service_role;
-- New metadata cannot be rewritten to reinterpret a past allocation.
create function public.icash_guard_shared_learning_assignment_v2() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.learning_decision_id is not null and new is distinct from old then raise exception 'Learning assignment is immutable';end if;
 if old.learning_decision_id is null and new.learning_decision_id is not null then raise exception 'Historical learning assignment cannot be relabelled';end if;
 return new;
end $$;
create trigger icash_shared_assignment_v2_immutable before update on public.icash_learning_assignments for each row execute function public.icash_guard_shared_learning_assignment_v2();
revoke all on function public.icash_learning_bounds_v2(numeric,numeric),public.icash_learning_decision_v2(jsonb,text[],boolean),public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean),public.icash_guard_shared_learning_assignment_v2() from public,anon,authenticated;
grant execute on function public.icash_learning_bounds_v2(numeric,numeric),public.icash_learning_decision_v2(jsonb,text[],boolean),public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean) to service_role;
commit;
