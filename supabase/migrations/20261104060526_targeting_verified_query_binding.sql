-- A separately reviewed query path uses the exact synchronized provider list.
-- It never enables the old global exclusion policy or rewrites account configs.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table icash_research_private.targeting_query_settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 list_id text check(list_id ~ '^[A-Za-z0-9_-]{1,100}$'),release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),activated_at timestamptz,
 check(not enabled or (list_id is not null and release_sha is not null and activated_at is not null))
);
insert into icash_research_private.targeting_query_settings(id) values(1);
create table icash_research_private.targeting_query_admissions(
 operation_key text primary key,account_id uuid not null,transaction_id bigint not null,
 scope jsonb not null,policy jsonb not null,exclusion_synced_at timestamptz not null
);
alter table icash_research_private.targeting_query_settings enable row level security;
alter table icash_research_private.targeting_query_admissions enable row level security;
revoke all on icash_research_private.targeting_query_settings,icash_research_private.targeting_query_admissions from public,anon,authenticated,service_role;

-- This read chooses no audience and grants no spend authority. Before the first
-- experiment an unavailable list leaves ordinary queries alone. Once a ZIP has
-- experimental paid work, pausing experiments cannot reopen unfiltered overlap.
create function public.icash_targeting_query_context(p_account uuid,p_revision uuid,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.icash_discovery_configs;q icash_research_private.targeting_query_settings;e icash_research_private.exclusions;
 history boolean;active boolean;ready boolean;required boolean;policy jsonb;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account and revision=p_revision and next_page=p_page;
 if not found then return jsonb_build_object('required',true,'ready',false,'policy',null);end if;
 select * into q from icash_research_private.targeting_query_settings where id=1;
 select * into e from icash_research_private.exclusions where id=1;
 history:=exists(select 1 from public.icash_discovery_filter_pages p where p.zip=c.zip
  and p.plan->>'version'='seller-targeting-v1' and p.state not in ('empty','unavailable'));
 active:=exists(select 1 from icash_research_private.targeting_experiments x where public.icash_targeting_available(p_account,c.zip,x.definition));
 ready:=coalesce(q.enabled and e.state='ready' and e.list_id=q.list_id and e.last_synced_at<=now()
  and e.last_synced_at is not null
  and not exists(select 1 from icash_research_private.exclusion_items where synced_at is null)
  and not exists(select 1 from icash_research_private.targeting_acquired_properties where synced_at is null)
  and not exists(select 1 from public.icash_operation_spend o
   cross join lateral (select array(select known.zip from (
    select fp.zip from public.icash_discovery_filter_pages fp where fp.operation_key=o.operation_key and fp.account_id=o.account_id
    union select public.icash_stalled_search_configuration(o.account_id,o.operation_key)->>'zip'
    union select estimate.query#>>'{locations,0,code}' from icash_research_private.estimates estimate
     where estimate.operation_key=o.operation_key and estimate.account_id=o.account_id
      and jsonb_array_length(case when jsonb_typeof(estimate.query->'locations')='array' then estimate.query->'locations' else '[]'::jsonb end)=1
      and estimate.query->'locations'=jsonb_build_array(jsonb_build_object('type','zip_code','code',estimate.query#>>'{locations,0,code}'))
    union select prior.zip from public.icash_discovery_configs prior where prior.account_id=o.account_id
     and o.operation_key='discovery:'||prior.account_id||':'||prior.revision||':'||prior.next_page
   ) known where known.zip ~ '^[0-9]{5}$') zips) scopes
   where o.operation_key like 'discovery:%' and o.state not in ('settled','cancelled')
    and not (o.operation_key='discovery:'||p_account||':'||p_revision||':'||p_page and o.state='reserved')
    and (cardinality(scopes.zips)=0 or c.zip=any(scopes.zips))),false);
 required:=history;
 if ready and (history or active) then policy:=jsonb_build_object('version',case when c.research_version=1 then 'research-efficiency-v1' else 'research-efficiency-v2' end,'exclusionListId',q.list_id);end if;
 return jsonb_build_object('required',required,'ready',ready and (history or active),'policy',policy);
end $$;

create function icash_research_private.targeting_policy_allowed(p_account uuid,p_scope jsonb,p_plan jsonb,p_policy jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c public.icash_discovery_configs;context jsonb;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account;
 context:=public.icash_targeting_query_context(p_account,(p_scope->>'p_revision')::uuid,(p_scope->>'p_page')::integer);
 if context->'required'='true'::jsonb or p_plan->>'version'='seller-targeting-v1' then
  return context->'ready'='true'::jsonb and p_policy is not distinct from context->'policy';
 end if;
 return (coalesce(c.research_version,0)=0 and p_policy is null)
  or (c.research_version in (1,2) and p_policy is not distinct from jsonb_build_object('version',case when c.research_version=2 then 'research-efficiency-v2' else 'research-efficiency-v1' end,'exclusionListId',c.research_list_id)
   and (c.research_list_id is null or not exists(select 1 from icash_research_private.exclusion_items where synced_at is null)));
end $$;

create function public.icash_targeting_query_admitted(p_account uuid,p_scope jsonb,p_required boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;op text;
begin
 context:=public.icash_targeting_query_context(p_account,(p_scope->>'p_revision')::uuid,(p_scope->>'p_page')::integer);
 if not p_required and context->'required' is distinct from 'true'::jsonb then return true;end if;
 if context->'ready' is distinct from 'true'::jsonb then return false;end if;
 op:='discovery:'||p_account||':'||(p_scope->>'p_revision')||':'||(p_scope->>'p_page');
 return exists(select 1 from icash_research_private.targeting_query_admissions a
  join icash_research_private.exclusions e on e.id=1 and e.last_synced_at=a.exclusion_synced_at and e.list_id=a.policy->>'exclusionListId' and e.state='ready'
  where a.operation_key=op and a.account_id=p_account and a.transaction_id=txid_current()
   and a.scope=p_scope-'p_account' and a.policy=context->'policy');
end $$;

create or replace function public.icash_targeting_dedup_ready(p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select (public.icash_targeting_query_context(c.account_id,c.revision,c.next_page)->'ready')='true'::jsonb
 from public.icash_discovery_configs c where c.account_id=p_account),false);
$$;

do $patch$
declare d text;needle text;replacement text;signature text;
begin
 -- Keep every existing scope, rate, permission, Pause, quota and unknown-operation
 -- predicate; only the exact policy comparison gains the independent path.
 signature:='public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb)';d:=pg_get_functiondef(signature::regprocedure);
 if md5(d)<>'3d432e9f3150f4f4e04c9cac77b1aa14' then raise exception 'Query readiness prerequisite changed';end if;
 needle:=$old$ if (c.research_version=0 and p_policy is not null)
  or (c.research_version in (1,2) and p_policy is distinct from jsonb_build_object('version',
   case when c.research_version=2 then 'research-efficiency-v2' else 'research-efficiency-v1' end,'exclusionListId',c.research_list_id))
  or (c.research_list_id is not null and exists(select 1 from icash_research_private.exclusion_items where synced_at is null)) then return false;end if;$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Query policy comparison changed';end if;
 execute replace(d,needle,' if not icash_research_private.targeting_policy_allowed(p_account,p_scope,p_plan,p_policy) then return false;end if;');

 signature:='public.icash_reserve_research_discovery(uuid,jsonb,jsonb,jsonb)';d:=pg_get_functiondef(signature::regprocedure);
 if md5(d)<>'e20f9de3115ec76c29aa8f6996d5bc1a' then raise exception 'Query reserve prerequisite changed';end if;
 needle:=$old$ if coalesce(c.research_version,0) not in (1,2) or p_policy is distinct from jsonb_build_object('version',case when c.research_version=2 then 'research-efficiency-v2' else 'research-efficiency-v1' end,'exclusionListId',c.research_list_id) then return false;end if;
 if c.research_list_id is not null and exists(select 1 from icash_research_private.exclusion_items where synced_at is null) then return false;end if;$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Query reserve policy changed';end if;
 d:=replace(d,needle,$new$ -- Stabilize activation/list generation under the original budget/account/config locks.
 perform 1 from icash_research_private.targeting_query_settings where id=1 for share;
 perform 1 from icash_research_private.targeting_settings where id=1 for share;
 perform 1 from icash_research_private.targeting_experiments where id=(p_plan->'targeting'->>'id')::uuid for share;
 perform 1 from icash_research_private.exclusions where id=1 for share;
 if not icash_research_private.targeting_policy_allowed(p_account,p_scope,p_plan,p_policy) then return false;end if;$new$);
 needle:=' if p_plan is not null then';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Query reserve dispatch boundary changed';end if;
 d:=replace(d,needle,$new$ op:='discovery:'||p_account||':'||(p_scope->>'p_revision')||':'||(p_scope->>'p_page');
 if p_plan->>'version'='seller-targeting-v1' or public.icash_targeting_query_context(p_account,(p_scope->>'p_revision')::uuid,(p_scope->>'p_page')::integer)->'required'='true'::jsonb then
  insert into icash_research_private.targeting_query_admissions(operation_key,account_id,transaction_id,scope,policy,exclusion_synced_at)
  select op,p_account,txid_current(),jsonb_build_object(
   'p_zip',p_scope->>'p_zip','p_revision',(p_scope->>'p_revision')::uuid,'p_page',(p_scope->>'p_page')::integer,
   'p_per_page',(p_scope->>'p_per_page')::integer,'p_rate',(p_scope->>'p_rate')::uuid,'p_unit',(p_scope->>'p_unit')::bigint,
   'p_permission_until',(p_scope->>'p_permission_until')::timestamptz,'p_setup_revision',(p_scope->>'p_setup_revision')::integer,
   'p_market_mode',p_scope->>'p_market_mode','p_market',p_scope->>'p_market'),p_policy,e.last_synced_at from icash_research_private.exclusions e where e.id=1;
 end if;
$new$||needle);
 needle:=' if not ok then return false;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Query reserve result boundary changed';end if;
 d:=replace(d,needle,' delete from icash_research_private.targeting_query_admissions where operation_key=op and transaction_id=txid_current();'||E'\n'||needle);
 execute d;

 signature:='public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text)';d:=pg_get_functiondef(signature::regprocedure);
 if md5(d)<>'6ec17e4342992d1880e270e2640002a5' then raise exception 'Core admission prerequisite changed';end if;
 needle:=' select * into o from public.icash_operation_spend where operation_key=op for update;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Core admission operation boundary changed';end if;
 execute replace(d,needle,$new$ if not public.icash_targeting_query_admitted(p_account,jsonb_build_object(
  'p_zip',p_zip,'p_revision',p_revision,'p_page',p_page,'p_per_page',p_per_page,'p_rate',p_rate,'p_unit',p_unit,
  'p_permission_until',p_permission_until,'p_setup_revision',p_setup_revision,'p_market_mode',p_market_mode,'p_market',p_market)) then return false;end if;
$new$||needle);

 -- The core does not know the plan. A first experimental page therefore
 -- also proves transaction-bound query authority at the filtered boundary.
 signature:='public.icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb)';d:=pg_get_functiondef(signature::regprocedure);
 if md5(d)<>'2e99bdc31a296887cf4059199d146d45' then raise exception 'Filtered admission prerequisite changed';end if;
 needle:=' if not public.icash_reserve_and_claim_property_discovery(p_account,p_zip,p_revision,p_page,p_per_page,p_rate,p_unit,p_permission_until,p_setup_revision,p_market_mode,p_market) then return false;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Filtered admission boundary changed';end if;
 execute replace(d,needle,$new$ if p_plan->>'version'='seller-targeting-v1' and not public.icash_targeting_query_admitted(p_account,jsonb_build_object(
  'p_zip',p_zip,'p_revision',p_revision,'p_page',p_page,'p_per_page',p_per_page,'p_rate',p_rate,'p_unit',p_unit,
  'p_permission_until',p_permission_until,'p_setup_revision',p_setup_revision,'p_market_mode',p_market_mode,'p_market',p_market),true) then return false;end if;
$new$||needle);

 -- Do not consume an old static-page cache for a new mutable list query.
 signature:='public.icash_prepare_discovery_inventory(uuid,uuid,integer)';d:=pg_get_functiondef(signature::regprocedure);
 if md5(d)<>'fd7c78f6ac101543cb00bf2559494382' then raise exception 'Inventory query prerequisite changed';end if;
 needle:=' if c.research_list_id is not null then return ''ready'';end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Inventory policy boundary changed';end if;
 d:=replace(d,' perform public.icash_discovery_filter_state_v2(p_account,p_revision,p_page);',
  ' perform public.icash_discovery_filter_state_v2(p_account,p_revision,p_page);'||E'\n'||' perform public.icash_targeting_state(p_account,p_revision,p_page);');
 execute replace(d,needle,$new$ if public.icash_targeting_query_context(p_account,p_revision,p_page)->'required'='true'::jsonb then
  return case when public.icash_targeting_query_context(p_account,p_revision,p_page)->'ready'='true'::jsonb then 'ready' else 'inventory_held' end;
 end if;
$new$||needle);

 -- Learning compares the actual current query identity, without assigning that
 -- list to old configs or reinterpreting historical list-free receipts.
 signature:='public.icash_targeting_learning_evidence(uuid,text,uuid)';d:=pg_get_functiondef(signature::regprocedure);
 needle:=$old$jsonb_build_object('version','research-efficiency-v2','exclusionListId',c.research_list_id) query_policy$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Targeting evidence policy changed';end if;
 d:=replace(d,needle,$new$public.icash_targeting_query_context(c.account_id,c.revision,c.next_page)->'policy' query_policy$new$);
 needle:='c.research_version=2 and c.research_list_id is not null';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Targeting evidence scope changed';end if;
 execute replace(d,needle,$new$public.icash_targeting_query_context(c.account_id,c.revision,c.next_page)->'ready'='true'::jsonb$new$);
 signature:='public.icash_targeting_state(uuid,uuid,integer)';d:=pg_get_functiondef(signature::regprocedure);
 needle:=$old$jsonb_build_object('version','research-efficiency-v2','exclusionListId',c.research_list_id)$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Targeting context policy changed';end if;
 d:=replace(d,needle,$new$public.icash_targeting_query_context(c.account_id,c.revision,c.next_page)->'policy'$new$);
 needle:=' if state is null then return null;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Targeting disabled context changed';end if;
 d:=replace(d,needle,$new$ state:=coalesce(state,'{}'::jsonb)||jsonb_build_object('queryContext',public.icash_targeting_query_context(p_account,p_revision,p_page));$new$);
 execute d;
end $patch$;
revoke all on function public.icash_targeting_query_context(uuid,uuid,integer),icash_research_private.targeting_policy_allowed(uuid,jsonb,jsonb,jsonb),public.icash_targeting_query_admitted(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.icash_targeting_query_context(uuid,uuid,integer),icash_research_private.targeting_policy_allowed(uuid,jsonb,jsonb,jsonb),public.icash_targeting_query_admitted(uuid,jsonb,boolean) to service_role;
commit;
