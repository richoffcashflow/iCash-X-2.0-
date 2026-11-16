-- Assemble and validate the account graph once for a bounded refresh batch.
-- Original settled customer charges are separate from verified supplier costs.
create function icash_learning_private.outcome_window_cost_batch(p_account uuid,p_trials jsonb)
returns table(property_id text,started_at timestamptz,window_days integer,costs jsonb)
language plpgsql stable security definer set search_path='' as $function$
declare valid_trials integer;
begin
 -- Disabled consumers submit []. Do not touch the cost graph in that path.
 if p_account is null or jsonb_typeof(p_trials) is distinct from 'array' then return;end if;
 if jsonb_array_length(p_trials)=0 or jsonb_array_length(p_trials)>2000 then return;end if;
 begin
  select count(*) into valid_trials from jsonb_to_recordset(p_trials) t(property_id text,started_at timestamptz,window_days integer)
  where nullif(btrim(t.property_id),'') is not null and isfinite(t.started_at) and t.window_days in (30,60)
   and t.started_at+make_interval(days=>t.window_days)<=now();
  -- Reviewed consumers use one original first exposure per property. Reject
  -- arbitrary repeated starts before they can multiply the account graph.
  if exists(select 1 from jsonb_to_recordset(p_trials) t(property_id text,started_at timestamptz,window_days integer)
   where nullif(btrim(t.property_id),'') is not null and isfinite(t.started_at) and t.window_days in (30,60)
    and t.started_at+make_interval(days=>t.window_days)<=now()
   group by t.property_id having count(distinct t.started_at)>1) then return;end if;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return;
 end;
 if valid_trials=0 then return;end if;
 return query
 with trials as materialized (
  select row_number() over(order by t.property_id,t.started_at,t.window_days) trial_id,t.* from (
   select distinct x.property_id,x.started_at,x.window_days from jsonb_to_recordset(p_trials) x(property_id text,started_at timestamptz,window_days integer)
   where nullif(btrim(x.property_id),'') is not null and isfinite(x.started_at) and x.window_days in (30,60)
    and x.started_at+make_interval(days=>x.window_days)<=now()
  )t
 ), scope as materialized (
  select s.snapshot->>'propertyId' property_id,min(s.created_at) created_at
  from public.icash_screening_jobs s where s.account_id=p_account
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and s.snapshot->>'propertyId' not like 'practice_%'
  group by s.snapshot->>'propertyId'
 ), sources as materialized (
  select * from icash_learning_private.outcome_cost_sources(p_account)
 ), source_clocks as materialized (
  select s.*,o.dispatched_at,coalesce(o.dispatched_at,o.created_at,s.created_at) operation_at
  from sources s left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=s.operation_key
 ), starts as (
  select s.property_id,min(s.operation_at) first_at from source_clocks s group by s.property_id
 ), bounds as materialized (
  select t.*,least(t.started_at,s.created_at,k.first_at) first_at,t.started_at+make_interval(days=>t.window_days) end_at,
   s.property_id is not null scoped
  from trials t left join scope s on s.property_id=t.property_id left join starts k on k.property_id=t.property_id
 ), mappings as materialized (
  select s.operation_key,count(distinct s.property_id) properties,bool_or(s.unattributed or s.property_id is null) ambiguous,
   min(s.share_count) min_shares,max(s.share_count) max_shares,
   count(distinct s.share_rank) ranks,count(distinct (s.property_id,s.share_rank)) property_ranks,
   min(s.share_rank) first_rank,max(s.share_rank) last_rank,bool_and(s.acquisition) acquisition
  from sources s group by s.operation_key
 ), valid_mappings as materialized (
  select m.*,not m.ambiguous and m.properties=m.max_shares and m.min_shares=m.max_shares
   and m.ranks=m.max_shares and m.property_ranks=m.properties and m.first_rank=1 and m.last_rank=m.max_shares
   and (m.max_shares=1 or m.acquisition) valid
  from mappings m
 ), candidate_groups as (
  select b.trial_id,s.operation_key,bool_or(s.unattributed) unattributed,bool_or(s.acquisition) acquisition,
   min(s.share_count) share_count,min(s.share_rank) share_rank,bool_or(not m.valid) conflicting
  from bounds b join source_clocks s on s.property_id=b.property_id join valid_mappings m using(operation_key)
  where s.operation_at between (case when s.acquisition then b.first_at else b.started_at end) and b.end_at
   or (s.dispatched_at is null and s.observed_at between (case when s.acquisition then b.first_at else b.started_at end) and b.end_at)
  group by b.trial_id,s.operation_key
 ), candidates as materialized (
  select k.* from (select g.*,row_number() over(partition by g.trial_id order by g.operation_key) ordinal from candidate_groups g) k
  where k.ordinal<=10001
 ), operation_checks as materialized (
  -- Validate each ledger/coverage operation once, even when it occurs in both
  -- horizons or in multiple conserved acquisition shares.
  select k.operation_key,o.created_at,o.dispatched_at,o.actual_micros,o.cost_basis,
   coalesce(o.charged_cents-v.covered_cents,o.charged_cents) net_cents,
   coalesce(o.state='settled' and o.charged_cents>=0 and o.dispatched_at>=o.created_at
    and o.settled_at between o.dispatched_at and now() and nullif(btrim(o.settlement_evidence),'') is not null
    and ((o.charged_cents=0 and u.n=0) or (o.charged_cents>0 and u.n=1 and u.amount=-o.charged_cents and u.valid))
    and ((v.operation_key is null and c.n=0) or (v.account_id=p_account and v.gross_cents=o.charged_cents and v.customer_cents>=0
     and v.covered_cents>0 and v.customer_cents+v.covered_cents=v.gross_cents and nullif(btrim(v.evidence_ref),'') is not null
     and c.n=1 and c.amount=v.covered_cents and c.valid)),false) verified
  from (select distinct k.operation_key from candidates k) k
  left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key=k.operation_key
  left join public.icash_usage_coverage v on v.operation_key=k.operation_key
  cross join lateral(select count(*) n,min(l.delta_cents) amount,bool_and(l.kind='usage' and nullif(btrim(l.evidence_ref),'') is not null) valid
   from public.icash_credit_ledger l where l.account_id=p_account and l.event_key='usage:'||k.operation_key) u
  cross join lateral(select count(*) n,min(l.delta_cents) amount,bool_and(l.kind='grant' and nullif(btrim(l.evidence_ref),'') is not null) valid
   from public.icash_credit_ledger l where l.account_id=p_account and l.event_key='usage-coverage:'||k.operation_key) c
 ), checked as (
  select k.*,o.actual_micros,o.cost_basis,o.net_cents,
   coalesce(o.verified and not k.unattributed and not k.conflicting and k.share_count>0 and k.share_rank between 1 and k.share_count
    and o.dispatched_at between (case when k.acquisition then b.first_at else b.started_at end) and b.end_at,false) verified
  from candidates k join bounds b using(trial_id) join operation_checks o using(operation_key)
 ), unbound as materialized (
  -- Identify account operations lacking an exact, conserved source once.
  select o.operation_key,coalesce(o.dispatched_at,o.created_at) operation_at,coalesce(m.acquisition,false) acquisition
  from public.icash_operation_spend o left join valid_mappings m on m.operation_key=o.operation_key
  where o.account_id=p_account and (o.dispatched_at is not null or o.state in ('dispatched','settled','needs_review'))
   and coalesce(m.valid,false) is not true
 ), unknown_keys as (
  select b.trial_id,u.operation_key from bounds b join unbound u on u.operation_at<=b.end_at
   and (u.operation_at>=b.first_at or u.acquisition)
  union
  select b.trial_id,s.operation_key from bounds b join sources s on s.property_id is null and s.unattributed
   and (s.created_at<=b.end_at and (s.acquisition or s.created_at>=b.first_at) or s.observed_at between b.first_at and b.end_at)
 ), unknown as (
  select u.trial_id,count(*) n from unknown_keys u group by u.trial_id
 ), totals as (
  select k.trial_id,count(*) n,count(*) filter(where not k.verified) unresolved,count(*) filter(where k.unattributed or k.conflicting) unattributed,
   coalesce(sum(k.net_cents/k.share_count+case when k.share_rank<=mod(k.net_cents,k.share_count) then 1 else 0 end) filter(where k.verified),0) cents,
   coalesce(sum(k.actual_micros/k.share_count+case when k.share_rank<=mod(k.actual_micros,k.share_count) then 1 else 0 end)
    filter(where k.verified and k.cost_basis='verified' and k.actual_micros>=0),0) supplier,
   bool_and(k.verified) complete,bool_and(k.verified and k.cost_basis='verified' and k.actual_micros>=0) supplier_complete
  from checked k group by k.trial_id
 ), source_size as (select count(*) n from sources)
 select b.property_id,b.started_at,b.window_days,
  jsonb_build_object('scope','property-outcome-costs-v1','windowDays',b.window_days,'operationCount',coalesce(t.n,0),
   'costCents',coalesce(t.cents,0),'unresolved',coalesce(t.unresolved,0),'unattributed',coalesce(t.unattributed,0),'unboundOperations',coalesce(u.n,0),
   'truncated',coalesce(t.n>10000,false) or z.n>=100001,
   'providerCostMicros',coalesce(t.supplier,0),'providerCostsComplete',t.supplier_complete is true and coalesce(u.n,0)=0 and coalesce(t.n between 1 and 10000,false) and z.n<100001 and b.scoped,
   'complete',t.complete is true and coalesce(u.n,0)=0 and coalesce(t.n between 1 and 10000,false) and z.n<100001 and b.scoped)
 from bounds b left join totals t using(trial_id) left join unknown u using(trial_id) cross join source_size z
 order by b.trial_id;
end;
$function$;
revoke all on function icash_learning_private.outcome_window_cost_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function icash_learning_private.outcome_window_cost_batch(uuid,jsonb) to service_role;

-- Preserve the private single-property interface for diagnostics and callers.
create function icash_learning_private.outcome_window_costs(p_account uuid,p_property text,p_start timestamptz,p_days integer)
returns jsonb language sql stable security definer set search_path='' as $function$
 select coalesce((select b.costs from icash_learning_private.outcome_window_cost_batch(p_account,
  jsonb_build_array(jsonb_build_object('property_id',p_property,'started_at',p_start,'window_days',p_days))) b limit 1),
  jsonb_build_object('scope','property-outcome-costs-v1','windowDays',p_days,'operationCount',0,'costCents',0,
   'unresolved',0,'unattributed',0,'unboundOperations',0,'truncated',false,'providerCostMicros',0,'providerCostsComplete',false,'complete',false));
$function$;
revoke all on function icash_learning_private.outcome_window_costs(uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function icash_learning_private.outcome_window_costs(uuid,text,timestamptz,integer) to service_role;
