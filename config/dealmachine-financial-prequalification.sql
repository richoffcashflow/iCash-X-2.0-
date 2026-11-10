-- Exact, prospective financial query identity. Install disabled; preserve old claims.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table icash_research_private.financial_settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 as_of date,release_sha text,activated_at timestamptz,metadata_next_at timestamptz not null default now(),
 check(not enabled or(as_of is not null and release_sha ~ '^[a-f0-9]{40}$' and activated_at is not null))
);
insert into icash_research_private.financial_settings(id) values(1);
create table icash_research_private.financial_widenings(
 account_id uuid not null references public.icash_accounts(id),revision uuid not null,tier integer not null check(tier in(0,1)),
 operation_key text not null,policy jsonb not null,query jsonb not null,response jsonb not null,created_at timestamptz not null default now(),
 primary key(account_id,revision,tier)
);
alter table icash_research_private.financial_settings enable row level security;
alter table icash_research_private.financial_widenings enable row level security;
revoke all on icash_research_private.financial_settings,icash_research_private.financial_widenings from public,anon,authenticated,service_role;
alter table icash_research_private.estimates add column shared_from_operation text;

create function icash_research_private.financial_filters(p_policy jsonb,p_plan jsonb default null) returns jsonb
language plpgsql immutable set search_path='' as $$
declare filters jsonb;tier integer;as_of date;floor_value numeric;
begin
 if p_policy->>'version' is distinct from 'financial-prefilter-v1'
  or p_policy is distinct from jsonb_build_object('version','financial-prefilter-v1','exclusionListId',p_policy->'exclusionListId','asOf',p_policy->'asOf','tier',p_policy->'tier')
  or coalesce(p_policy->>'exclusionListId','') !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_policy->'tier') is distinct from 'number' or p_policy->>'tier' not in('0','1','2')
  or coalesce(p_policy->>'asOf','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
 tier:=(p_policy->>'tier')::integer;as_of:=(p_policy->>'asOf')::date;
 if to_char(as_of,'YYYY-MM-DD')<>p_policy->>'asOf' then return null;end if;
 floor_value:=case when p_plan->>'strategy'='repairs' or p_plan#>>'{targeting,segment}'='off_market_repairs' then 50000 else 14285.72 end;
 filters:=jsonb_build_array(
  jsonb_build_object('filter_id','market_status','operator','contains_any','value',jsonb_build_array(6)),
  jsonb_build_object('filter_id','estimated_value','operator','greater_than','value',floor_value),
  jsonb_build_object('filter_id','estimated_repair_cost','operator','greater_than_or_equal','value',0),
  jsonb_build_object('filter_id','num_total_active_liens','operator','less_than_or_equal','value',0));
 if tier<2 then
  filters:=filters||jsonb_build_array(
   jsonb_build_object('filter_id','estimated_equity_percentage','operator','greater_than_or_equal','value',case when tier=0 then 90 else 80 end),
   jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(as_of-case when tier=0 then interval '10 years' else interval '7 years' end,'YYYY-MM-DD')));
  if tier=0 then filters:=filters||'[{"filter_id":"has_absentee_owners","value":true}]'::jsonb;end if;
 end if;
 return filters;
exception when others then return null;
end $$;

create function icash_research_private.financial_capable() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;f jsonb;m jsonb;
begin
 select result into c from public.icash_integration_checks where provider='dealmachine_targeting' and checked_at between now()-interval '7 days' and now();
 if c->>'status' is distinct from 'verified' or c->'catalogVersion' is distinct from '4'::jsonb or c#>'{plan,is_paid}' is distinct from 'true'::jsonb then return false;end if;
 for f in select value from jsonb_array_elements(icash_research_private.financial_filters(jsonb_build_object('version','financial-prefilter-v1','exclusionListId','capability-check','asOf',current_date::text,'tier',0))||'[ {"filter_id":"property_type","operator":"contains_any","value":[1]}, {"filter_id":"has_active_lien","value":false}, {"filter_id":"has_hoa_lien","value":false}, {"filter_id":"is_tax_delinquent","value":false}]'::jsonb) loop
  if (select count(*) from jsonb_array_elements(c->'filters') x where x->>'filter_id'=f->>'filter_id')<>1 then return false;end if;
  select value into m from jsonb_array_elements(c->'filters') x where x->>'filter_id'=f->>'filter_id';
  if m->'is_premium_filter' is distinct from 'false'::jsonb
   or m->>'type' is distinct from (case when jsonb_typeof(f->'value')='boolean' then 'BOOLEAN' when f->>'filter_id'='last_sale_date' then 'DATE' when f->>'filter_id' in('market_status','property_type') then 'MULTI_SELECT' else 'NUMBER' end)
   or (f ? 'operator' and not coalesce(m->'allowed_operators' ? (f->>'operator'),false)) then return false;end if;
  if f->>'filter_id'='market_status' and (select count(*) from jsonb_array_elements(m->'options') o where o->'option_id'='6'::jsonb and o->>'label'='Off Market')<>1 then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function icash_research_private.financial_policy(p_account uuid,p_revision uuid,p_base jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version','financial-prefilter-v1','exclusionListId',p_base->'exclusionListId','asOf',s.as_of::text,
  'tier',coalesce((select max(w.tier)+1 from icash_research_private.financial_widenings w where w.account_id=p_account and w.revision=p_revision),0))
 from icash_research_private.financial_settings s where s.id=1 and s.enabled and s.as_of<=current_date;
$$;

-- One bounded GET-only catalog refresh across workers, with failure backoff.
create function public.icash_claim_financial_metadata() returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.icash_integration_checks where provider='dealmachine_targeting'
  and checked_at between now()-interval '1 day' and now() and result->>'status'='verified' and result->'catalogVersion'='4'::jsonb) then return false;end if;
 update icash_research_private.financial_settings set metadata_next_at=now()+interval '15 minutes'
  where id=1 and enabled and metadata_next_at<=now();
 return found;
end $$;
revoke all on function public.icash_claim_financial_metadata() from public,anon,authenticated;
grant execute on function public.icash_claim_financial_metadata() to service_role;

create function icash_research_private.financial_query_valid(p_query jsonb,p_policy jsonb,p_plan jsonb,p_scope jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare filters jsonb;extra jsonb;strategy text:=coalesce(p_plan->>'strategy','baseline');
begin
 extra:=icash_research_private.financial_filters(p_policy,p_plan);if extra is null then return false;end if;
 filters:='[{"filter_id":"property_type","operator":"contains_any","value":[1]},{"filter_id":"estimated_equity_percentage","operator":"greater_than_or_equal","value":70}]';
 if p_plan->>'version'='seller-targeting-v1' then filters:=filters||public.icash_targeting_filters(p_plan->'targeting');
 elsif strategy='vacant' then filters:=filters||'[{"filter_id":"is_vacant_home","value":true}]'::jsonb;
 elsif strategy='absentee' then filters:=filters||'[{"filter_id":"has_absentee_owners","value":true}]'::jsonb;
 elsif strategy='repairs' then filters:=filters||'[{"filter_id":"estimated_repair_cost","operator":"greater_than_or_equal","value":25000}]'::jsonb;
 elsif strategy<>'baseline' then return false;end if;
 filters:=filters||'[{"filter_id":"has_active_lien","value":false},{"filter_id":"has_hoa_lien","value":false},{"filter_id":"is_tax_delinquent","value":false}]'::jsonb||extra;
 return p_query=jsonb_build_object('locations',jsonb_build_array(jsonb_build_object('type','zip_code','code',p_scope->>'p_zip')),
  'anchor','properties','contact_audience','none','filters',filters,
  'fields','["dm_property_id","full_address","legal_description","address","city","state","zip","estimated_value","estimated_equity_percentage","estimated_equity_amount","total_estimated_loan_balance","has_active_lien","has_hoa_lien","num_total_active_liens","num_total_open_liens","total_open_lien_amount","is_tax_delinquent","is_free_and_clear","estimated_repair_cost","building_condition","living_area_sqft","num_bedrooms","num_bathrooms","year_built"]'::jsonb,
  'page',1,'per_page',p_scope->'p_per_page','exclude_lists',jsonb_build_object('property_list_ids',jsonb_build_array(p_policy->>'exclusionListId')),'estimate_cost',true);
exception when others then return false;
end $$;

-- The final locked reserve must match the exact fresh free estimate. Old workers
-- cannot spend under a v2 policy after activation; old paid receipts still settle.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure);
 if md5(d)<>'d501cff48bc2a47fc079ad6d1ece47d3' then raise exception 'Financial exclusion sync prerequisite changed';end if;
 needle:='exists(select 1 from icash_research_private.targeting_settings where id=1 and enabled)';
 if strpos(d,needle)=0 then raise exception 'Financial acquired-property sync changed';end if;
 execute replace(d,needle,'('||needle||' or exists(select 1 from icash_research_private.financial_settings where id=1 and enabled))');

 d:=pg_get_functiondef('public.icash_targeting_query_context(uuid,uuid,integer)'::regprocedure);
 if md5(d)<>'23b21269537a5e593a4e7586f90dd259' then raise exception 'Financial query context prerequisite changed';end if;
 d:=replace(d,'required:=history;', 'required:=history or exists(select 1 from icash_research_private.financial_settings where id=1 and enabled);');
 d:=replace(d,'(history or active)','(history or active or required)');
 needle:=' return jsonb_build_object(''required'',required,';
 if strpos(d,needle)=0 then raise exception 'Financial context return changed';end if;
 d:=replace(d,needle,$new$ if exists(select 1 from icash_research_private.financial_settings where id=1 and enabled) then
  ready:=ready and icash_research_private.financial_capable();
  if ready then policy:=icash_research_private.financial_policy(p_account,p_revision,policy);else policy:=null;end if;
 end if;
$new$||needle);execute d;

 d:=pg_get_functiondef('public.icash_claim_discovery_estimate(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'760292449e06f417895203534592aacd' then raise exception 'Financial estimate prerequisite changed';end if;
 needle:=' perform 1 from public.icash_operating_budget where id=1 for update;';
 if strpos(d,needle)=0 then raise exception 'Financial estimate admission changed';end if;
 d:=replace(d,needle,$new$ if p_policy->>'version'='financial-prefilter-v1' and not icash_research_private.financial_query_valid(p_query,p_policy,p_plan,p_scope) then return jsonb_build_object('status','held');end if;
$new$||needle);
 needle:='   update icash_research_private.estimates set shared_hits=shared_hits+1 where operation_key=peer.operation_key;';
 if strpos(d,needle)=0 then raise exception 'Financial shared estimate boundary changed';end if;
 d:=replace(d,needle,needle||$new$
   if p_policy->>'version'='financial-prefilter-v1' then
    update icash_research_private.estimates set query=p_query,exclusion_synced_at=generation,
     token=null,lease_until=null,retry_at=null,shared_from_operation=peer.operation_key,saved_at=peer.saved_at,updated_at=now(),
     response=jsonb_build_object('estimated_credits',jsonb_build_object('this_page',peer.response#>'{estimated_credits,this_page}',
      'breakdown',jsonb_build_object('people',peer.response#>'{estimated_credits,breakdown,people}')),
      'totals',jsonb_build_object('properties',peer.response#>'{totals,properties}'),
      'pagination',jsonb_build_object('total_results',peer.response#>'{pagination,total_results}'))
     where operation_key=op returning * into e;
    return jsonb_build_object('status','cached','response',e.response);
   end if;
$new$);execute d;

 d:=pg_get_functiondef('public.icash_reserve_research_discovery(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'ebe2fb3c2894cbdaf0ec66fe70866464' then raise exception 'Financial reserve prerequisite changed';end if;
 needle:=' if not icash_research_private.targeting_policy_allowed(p_account,p_scope,p_plan,p_policy) then return false;end if;';
 if strpos(d,needle)=0 then raise exception 'Financial reserve policy changed';end if;
 execute replace(d,needle,$new$ perform 1 from icash_research_private.financial_settings where id=1 for share;
$new$||needle||$new$
 if p_policy->>'version'='financial-prefilter-v1' and not exists(
  select 1 from icash_research_private.estimates e join icash_research_private.exclusions x on x.id=1 and x.last_synced_at=e.exclusion_synced_at
  where e.account_id=p_account and e.operation_key='discovery:'||p_account||':'||(p_scope->>'p_revision')||':'||(p_scope->>'p_page')
   and e.saved_at between now()-interval '5 minutes' and now() and e.token is null and e.lease_until is null
   and jsonb_typeof(e.response#>'{estimated_credits,this_page}')='number' and (e.response#>>'{estimated_credits,this_page}')::numeric between 1 and (p_scope->>'p_per_page')::integer
   and e.response#>'{estimated_credits,breakdown,people}'='0'::jsonb
   and icash_research_private.financial_query_valid(e.query,p_policy,p_plan,p_scope)) then return false;end if;
$new$);
end $patch$;

create function public.icash_widen_financial_query(p_account uuid,p_scope jsonb,p_plan jsonb,p_policy jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.estimates;op text;tier integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_discovery_configs where account_id=p_account for update;
 perform 1 from icash_research_private.financial_settings where id=1 for share;
 if not public.icash_research_query_ready(p_account,p_scope,p_plan,p_policy) or p_policy->>'version' is distinct from 'financial-prefilter-v1'
  or p_plan->>'version' is distinct from 'seller-filters-v1' or p_plan->>'strategy' is distinct from 'baseline' then return false;end if;
 tier:=(p_policy->>'tier')::integer;if tier not in(0,1) then return false;end if;
 op:='discovery:'||p_account||':'||(p_scope->>'p_revision')||':'||(p_scope->>'p_page');
 if exists(select 1 from public.icash_operation_spend where operation_key=op and state<>'cancelled') then return false;end if;
 select * into e from icash_research_private.estimates where operation_key=op and account_id=p_account for update;
 if not found or e.token is not null or e.lease_until is not null or e.saved_at is null or e.saved_at not between now()-interval '5 minutes' and now()
  or not icash_research_private.financial_query_valid(e.query,p_policy,p_plan,p_scope)
  or e.response#>'{estimated_credits,this_page}' is distinct from '0'::jsonb
  or e.response#>'{estimated_credits,breakdown,people}' is distinct from '0'::jsonb
  or e.response#>'{totals,properties}' is distinct from '0'::jsonb
  or e.response#>'{pagination,total_results}' is distinct from '0'::jsonb
  or e.exclusion_synced_at is distinct from (select last_synced_at from icash_research_private.exclusions where id=1 and state='ready' and list_id=p_policy->>'exclusionListId') then return false;end if;
 insert into icash_research_private.financial_widenings(account_id,revision,tier,operation_key,policy,query,response)
 values(p_account,(p_scope->>'p_revision')::uuid,tier,op,p_policy,e.query,e.response) on conflict do nothing;
 if not found then return false;end if;
 -- Reopen only this policy's proven free-empty audiences for the wider query.
 -- Paid, unavailable, historical and uncertain cursors are never reset.
 update public.icash_discovery_filter_cursors c set exhausted=false where c.account_id=p_account and c.revision=(p_scope->>'p_revision')::uuid and c.exhausted
  and exists(select 1 from public.icash_discovery_filter_pages fp join icash_research_private.estimates pe using(operation_key,account_id)
   where fp.account_id=c.account_id and fp.revision=c.revision and fp.plan->>'strategy'=c.strategy and fp.state='empty'
    and pe.response#>'{totals,properties}'='0'::jsonb and pe.response#>'{estimated_credits,this_page}'='0'::jsonb
    and icash_research_private.financial_query_valid(pe.query,p_policy,fp.plan,p_scope)
    and not exists(select 1 from public.icash_operation_spend where operation_key=fp.operation_key));
 return true;
end $$;

revoke all on function icash_research_private.financial_filters(jsonb,jsonb),icash_research_private.financial_capable(),icash_research_private.financial_policy(uuid,uuid,jsonb),icash_research_private.financial_query_valid(jsonb,jsonb,jsonb,jsonb),public.icash_widen_financial_query(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_widen_financial_query(uuid,jsonb,jsonb,jsonb) to service_role;
commit;
