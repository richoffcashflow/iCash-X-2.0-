-- Property-bound 30/60-day customer-spend evidence. Supplier costs are reported
-- separately; this is not profit, revenue, or a forecast of completed deals.
create table icash_learning_policy_private.outcome_cost_settings(
 id integer primary key check(id=1),installed_at timestamptz not null default now(),
 enabled_at timestamptz,release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),
 check(enabled_at is null or release_sha is not null)
);
insert into icash_learning_policy_private.outcome_cost_settings(id) values(1);
alter table icash_learning_policy_private.outcome_cost_settings enable row level security;
revoke all on icash_learning_policy_private.outcome_cost_settings from public,anon,authenticated,service_role;
grant select on icash_learning_policy_private.outcome_cost_settings to service_role;
create function public.icash_outcome_cost_learning_active() returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from icash_learning_policy_private.outcome_cost_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=c.release_sha
  join icash_learning_private.policy_releases r on r.release_sha=c.release_sha
  where c.id=1 and c.enabled_at between c.installed_at and now()
   and r.completed_at between c.installed_at and c.enabled_at and r.registered_at<=now()
   and s.activated_at between r.completed_at and c.enabled_at and s.evidence_after>=r.completed_at)
$$;
create function public.icash_activate_outcome_cost_learning(p_actor uuid,p_release_sha text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid or p_enabled is null then raise exception 'Owner required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(726341927);perform 1 from public.icash_operating_budget where id=1 for update;
 if not p_enabled then update icash_learning_policy_private.outcome_cost_settings set enabled_at=null where id=1;
  return jsonb_build_object('enabled',false);end if;
 if not exists(select 1 from icash_learning_policy_private.outcome_cost_settings c
  join icash_learning_policy_private.settings s on s.id=c.id and s.enabled and s.release_sha=p_release_sha
  join icash_learning_private.policy_releases r on r.release_sha=s.release_sha
  where c.id=1 and r.completed_at between c.installed_at and now() and r.registered_at<=now()
   and s.activated_at between r.completed_at and now() and s.evidence_after>=r.completed_at) then
  raise exception 'Canonical successful post-install learning release required';end if;
 update icash_learning_policy_private.outcome_cost_settings set release_sha=p_release_sha,
  enabled_at=case when release_sha=p_release_sha and enabled_at>=(select activated_at from icash_learning_policy_private.settings where id=1) then enabled_at else now() end where id=1;
 return jsonb_build_object('enabled',true,'releaseSha',p_release_sha);
end $$;
revoke all on function public.icash_outcome_cost_learning_active(),public.icash_activate_outcome_cost_learning(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_outcome_cost_learning_active(),public.icash_activate_outcome_cost_learning(uuid,text,boolean) to service_role;

alter table public.icash_learning_rollups add column outcome_costs jsonb;

-- Outcome cost rollup columns
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:=$needle$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)$needle$;
 replacement:=$replacement$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope,outcome_costs)$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost rollup columns prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Outcome cost rollup columns
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest_v6(uuid)'::regprocedure);
 needle:=$needle$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)$needle$;
 replacement:=$replacement$contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope,outcome_costs)$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost rollup columns prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;


-- Seller call batches every mature trial against one account cost graph.
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:=$needle$ )
 insert into public.icash_learning_rollups$needle$;
 replacement:=$replacement$ ), outcome_windows as materialized (
  select * from icash_learning_private.outcome_window_cost_batch(p_account,(
   select coalesce(jsonb_agg(jsonb_build_object('property_id',e.property_key,'started_at',e.started_at,'window_days',h.days)),'[]'::jsonb)
   from exposures e cross join (values(30),(60)) h(days)
   where public.icash_outcome_cost_learning_active() and e.started_at<=now()-make_interval(days=>h.days)
  ))
 )
 insert into public.icash_learning_rollups$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller call batched cost prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Seller text batches every mature trial against one account cost graph.
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest_v6(uuid)'::regprocedure);
 needle:=$needle$ )
 insert into public.icash_learning_rollups$needle$;
 replacement:=$replacement$ ), outcome_windows as materialized (
  select * from icash_learning_private.outcome_window_cost_batch(p_account,(
   select coalesce(jsonb_agg(jsonb_build_object('property_id',e.property_key,'started_at',e.started_at,'window_days',h.days)),'[]'::jsonb)
   from exposures e cross join (values(30),(60)) h(days)
   where public.icash_outcome_cost_learning_active() and e.started_at<=now()-make_interval(days=>h.days)
  ))
 )
 insert into public.icash_learning_rollups$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller text batched cost prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Seller-call mature cost windows
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 needle:=$needle$is true,'seller-contact-72h-v1'
 from exposures where costs->'priorContact'='false'::jsonb group by context,variant;$needle$;
 replacement:=$replacement$is true,'seller-contact-72h-v1',
  jsonb_build_object('scope','property-outcome-costs-v1','contracts',jsonb_build_object('costCents',coalesce(sum((c30.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c30.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '30 days' and e.opted_out),'providerCostMicros',coalesce(sum((c30.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c30.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true),'closings',jsonb_build_object('costCents',coalesce(sum((c60.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c60.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '60 days' and e.opted_out),'providerCostMicros',coalesce(sum((c60.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c60.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true))
 from exposures e left join outcome_windows c30(property_id,cost_start,window_days,window_cost) on c30.property_id=e.property_key and c30.cost_start=e.started_at and c30.window_days=30
 left join outcome_windows c60(property_id,cost_start,window_days,window_cost) on c60.property_id=e.property_key and c60.cost_start=e.started_at and c60.window_days=60 where costs->'priorContact'='false'::jsonb group by context,variant;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller-call mature cost windows prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Seller-text mature cost windows
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_refresh_seller_interest_v6(uuid)'::regprocedure);
 needle:=$needle$is true,'seller-contact-72h-v1'
 from exposures e join costs c on c.thread_id=e.thread_id where not c.prior_contact group by e.variant;$needle$;
 replacement:=$replacement$is true,'seller-contact-72h-v1',
  jsonb_build_object('scope','property-outcome-costs-v1','contracts',jsonb_build_object('costCents',coalesce(sum((c30.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c30.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '30 days' and e.contact_opted_out),'providerCostMicros',coalesce(sum((c30.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c30.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '30 days')) is true),'closings',jsonb_build_object('costCents',coalesce(sum((c60.window_cost->>'costCents')::bigint),0),'complete',(bool_and(coalesce(c60.window_cost->'complete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true,'optedOut',count(*) filter(where e.started_at<=now()-interval '60 days' and e.contact_opted_out),'providerCostMicros',coalesce(sum((c60.window_cost->>'providerCostMicros')::bigint),0),'providerCostsComplete',(bool_and(coalesce(c60.window_cost->'providerCostsComplete'='true'::jsonb,false)) filter(where e.started_at<=now()-interval '60 days')) is true))
 from exposures e join costs c on c.thread_id=e.thread_id left join outcome_windows c30(property_id,cost_start,window_days,window_cost) on c30.property_id=e.property_key and c30.cost_start=e.started_at and c30.window_days=30
 left join outcome_windows c60(property_id,cost_start,window_days,window_cost) on c60.property_id=e.property_key and c60.cost_start=e.started_at and c60.window_days=60 where not c.prior_contact group by e.variant;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Seller-text mature cost windows prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Canonical outcome cost aggregates
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_shared_learning_stats(text,text,text)'::regprocedure);
 needle:=$needle$sum(attempts*weight) effective_attempts$needle$;
 replacement:=$replacement$jsonb_build_object('scope','property-outcome-costs-v1','contracts',jsonb_build_object('cost_cents',coalesce(sum((outcome_costs->'contracts'->>'costCents')::bigint),0),'effective_cost_cents',coalesce(sum((outcome_costs->'contracts'->>'costCents')::numeric*weight),0),'effective_opted_out',coalesce(sum((outcome_costs->'contracts'->>'optedOut')::numeric*weight),0),'costs_complete',(bool_and(coalesce(outcome_costs->>'scope'='property-outcome-costs-v1' and outcome_costs->'contracts'->'complete'='true'::jsonb,false)) filter(where contract_trials>0)) is true and public.icash_outcome_cost_learning_active() and (p_domain='seller_calls' or (p_domain='seller_sms' and p_context='cash-question-v6'))),'closings',jsonb_build_object('cost_cents',coalesce(sum((outcome_costs->'closings'->>'costCents')::bigint),0),'effective_cost_cents',coalesce(sum((outcome_costs->'closings'->>'costCents')::numeric*weight),0),'effective_opted_out',coalesce(sum((outcome_costs->'closings'->>'optedOut')::numeric*weight),0),'costs_complete',(bool_and(coalesce(outcome_costs->>'scope'='property-outcome-costs-v1' and outcome_costs->'closings'->'complete'='true'::jsonb,false)) filter(where closing_trials>0)) is true and public.icash_outcome_cost_learning_active() and (p_domain='seller_calls' or (p_domain='seller_sms' and p_context='cash-question-v6')))) outcome_costs,
 sum(attempts*weight) effective_attempts$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Canonical outcome cost aggregates prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Outcome cost validation variables
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=$needle$s jsonb;k text;v numeric;stats jsonb;$needle$;
 replacement:=$replacement$s jsonb;k text;v numeric;window_key text;window_cost jsonb;stats jsonb;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost validation variables prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Outcome cost validation
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=$needle$  foreach k in array integers||numbers loop$needle$;
 replacement:=$replacement$  if s ? 'outcome_costs' and s->'outcome_costs'<>'null'::jsonb then
   if jsonb_typeof(s->'outcome_costs') is distinct from 'object' or s->'outcome_costs'->>'scope' is distinct from 'property-outcome-costs-v1' then return result;end if;
   foreach window_key in array array['contracts','closings'] loop
    window_cost:=s->'outcome_costs'->window_key;
    if jsonb_typeof(window_cost) is distinct from 'object' or jsonb_typeof(window_cost->'costs_complete') is distinct from 'boolean' then return result;end if;
    foreach k in array array['cost_cents','effective_cost_cents','effective_opted_out'] loop
     if jsonb_typeof(window_cost->k) is distinct from 'number' then return result;end if;
     v:=(window_cost->>k)::numeric;
     if v<0 or v>9007199254740991 or (k='cost_cents' and trunc(v)<>v) then return result;end if;
    end loop;
    k:=case window_key when 'contracts' then 'effective_contract_trials' else 'effective_closing_trials' end;
    if jsonb_typeof(s->k) is distinct from 'number' then return result;end if;
    if (window_cost->>'effective_opted_out')::numeric>(s->>k)::numeric then return result;end if;
   end loop;
  end if;
  foreach k in array integers||numbers loop$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Outcome cost validation prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Objective-specific cost denominator
do $patch$ declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_learning_decision_v2(jsonb,text[],boolean)'::regprocedure);
 needle:=$needle$ if objective<>'positive' and exists(select 1 from jsonb_array_elements(stats)r where r->>'cost_scope'='seller-contact-72h-v1') then
  return result||'{"reason":"outcome_window_costs_incomplete"}'::jsonb;end if;$needle$;
 replacement:=$replacement$ if objective<>'positive' and exists(select 1 from jsonb_array_elements(stats)r where r->>'cost_scope'='seller-contact-72h-v1') then
  if exists(select 1 from jsonb_array_elements(stats)r where r->>'cost_scope' is distinct from 'seller-contact-72h-v1'
   or r->'outcome_costs'->>'scope' is distinct from 'property-outcome-costs-v1'
   or r->'outcome_costs'->objective->'costs_complete' is distinct from 'true'::jsonb) then
   return result||'{"reason":"outcome_window_costs_incomplete"}'::jsonb;end if;
  select jsonb_agg(r||jsonb_build_object('cost_cents',r->'outcome_costs'->objective->'cost_cents',
   'effective_cost_cents',r->'outcome_costs'->objective->'effective_cost_cents','effective_opted_out',r->'outcome_costs'->objective->'effective_opted_out','costs_complete',true)) into stats from jsonb_array_elements(stats)r;
 end if;$replacement$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Objective-specific cost denominator prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
