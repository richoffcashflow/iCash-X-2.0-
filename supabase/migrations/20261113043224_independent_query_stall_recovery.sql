-- Resume the exact independent-query timeout family in a disjoint permitted ZIP.
-- Original request, money hold and source configuration remain immutable.
-- The caller owns the migration/receipt transaction. Activation is separate.
set local lock_timeout='5s';
set local statement_timeout='60s';
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_continue_stalled_research(uuid)'::regprocedure))<>'4d109f59b00bc401086070b7ff3ea048'
 then raise exception 'Independent search continuation prerequisite changed';end if;
end $guard$;
alter table icash_research_private.settings add column independent_query_continuation_enabled boolean not null default false;

CREATE OR REPLACE FUNCTION public.icash_continue_stalled_research(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs;o public.icash_operation_spend;r icash_research_private.requests;m public.icash_inventory_markets;op text;quote bigint;completed_errors boolean;
 independent_enabled boolean;independent_query boolean:=false;original_policy jsonb;blocked_zips text[];unscoped boolean;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 select completed_error_continuation_enabled,independent_query_continuation_enabled
 into completed_errors,independent_enabled from icash_research_private.settings
 where id=1 and enabled and stalled_search_continuation_enabled and not exclusions_enabled for share;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.enabled or not c.auto_enabled or c.data_rights_until<=now()
  or c.research_version<>2 or (c.research_list_id is null and not coalesce(completed_errors,false) and not independent_enabled) then return false;end if;
 op:='discovery:'||p_account||':'||c.revision||':'||c.next_page;
 -- Independent targeting keeps its exclusion list in the immutable query claim,
 -- not the mutable discovery configuration. Recognize only that exact family.
 select policy into original_policy from icash_research_private.query_claims
 where operation_key=op and account_id=p_account;
 independent_query:=independent_enabled and c.research_list_id is null
  and coalesce(original_policy=jsonb_build_object('version','research-efficiency-v2',
   'exclusionListId',original_policy->>'exclusionListId')
   and original_policy->>'exclusionListId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$',false)
  and exists(select 1 from public.icash_discovery_filter_pages where operation_key=op and account_id=p_account
   and revision=c.revision and sequence=c.next_page and zip=c.zip and state='claimed'
   and plan->>'version'='seller-targeting-v1');
 -- Never wait behind a late receipt writer while holding the configuration.
 select * into o from public.icash_operation_spend where operation_key=op and account_id=p_account for update skip locked;
 if not found or o.state<>'dispatched' or o.dispatched_at is null or o.dispatched_at>now()-interval '5 minutes'
  or o.rate_id<>c.rate_id or exists(select 1 from public.icash_discovery_results where operation_key=op)
  or exists(select 1 from public.icash_cost_observations where provider='dealmachine' and event_key=op)
  or exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind='discovery'
   and ((state='issued' and expires_at>now()) or (state='consumed' and greatest(created_at,expires_at)>now()-interval '5 minutes')))
  then return false;end if;
 select * into r from icash_research_private.requests where operation_key=op and account_id=p_account
  and kind='property_search' and admitted and (((c.research_list_id is not null or independent_query) and result->>'outcome'='unknown')
   or (completed_errors and result->>'outcome'='http_error' and result->'httpStatus'='500'::jsonb))
  and finished_at<=now()-interval '5 minutes' order by created_at limit 1;
 if not found or (select count(*) from icash_research_private.requests where operation_key=op and kind='property_search' and admitted)<>1
  or not exists(select 1 from icash_research_private.query_claims where operation_key=op and account_id=p_account
   and (policy=jsonb_build_object('version','research-efficiency-v2','exclusionListId',c.research_list_id)
    or (independent_query and policy=original_policy)))
  or not exists(select 1 from public.icash_discovery_filter_pages where operation_key=op and account_id=p_account
   and revision=c.revision and sequence=c.next_page and zip=c.zip and state='claimed')
  or exists(select 1 from public.icash_operation_spend other where other.account_id=p_account and other.operation_key like 'discovery:%'
   and other.state in ('reserved','dispatched') and other.operation_key<>op
   and not exists(select 1 from icash_research_private.stalled_searches q where q.operation_key=other.operation_key and q.account_id=p_account)) then return false;end if;
 select public.icash_research_admission_quote(p_account,'property_search',charge_cents) into quote
  from public.icash_operation_rates where id=c.rate_id and operation='property_search' and enabled and expires_at>now();
 if quote is null or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or public.icash_prospecting_available(p_account)<quote then return false;end if;
 if independent_query then
  -- Serialize existing customer scope changes. Missing setup retains the
  -- canonical scope predicate's existing default; no permissions are widened.
  perform 1 from public.icash_bot_setups where account_id=p_account for share;
  -- Resolve canonical unresolved scopes once, before the bounded market scan.
  -- An unscoped unknown cannot prove any alternative market is independent.
  with unresolved as materialized (
   select pending_op.operation_key,pending_op.account_id,scopes.zips from public.icash_operation_spend pending_op
   cross join lateral (select array(select known.zip from (
     select fp.zip from public.icash_discovery_filter_pages fp where fp.operation_key=pending_op.operation_key and fp.account_id=pending_op.account_id
     union select public.icash_stalled_search_configuration(pending_op.account_id,pending_op.operation_key)->>'zip'
     union select estimate.query#>>'{locations,0,code}' from icash_research_private.estimates estimate
      where estimate.operation_key=pending_op.operation_key and estimate.account_id=pending_op.account_id
       and jsonb_array_length(case when jsonb_typeof(estimate.query->'locations')='array' then estimate.query->'locations' else '[]'::jsonb end)=1
       and estimate.query->'locations'=jsonb_build_array(jsonb_build_object('type','zip_code','code',estimate.query#>>'{locations,0,code}'))
     union select prior.zip from public.icash_discovery_configs prior where prior.account_id=pending_op.account_id
      and pending_op.operation_key='discovery:'||prior.account_id||':'||prior.revision||':'||prior.next_page
    ) known where known.zip ~ '^[0-9]{5}$') zips) scopes
   where pending_op.operation_key like 'discovery:%' and pending_op.state not in ('settled','cancelled')
  )
  select coalesce(bool_or(cardinality(zips)=0),false),
   array(select distinct z.zip from unresolved u cross join lateral unnest(u.zips) z(zip) order by z.zip)
  into unscoped,blocked_zips from unresolved;
  if unscoped then return false;end if;
 end if;
 perform public.icash_expand_inventory_markets(p_account);
 select icash_inventory_markets.* into m from (select account_id,zip from public.icash_inventory_markets where account_id=p_account and zip<>c.zip
  and eligible_until>now() and next_scan_at<=now() and public.icash_research_zip_known(zip)
  and (not independent_query or not (zip=any(blocked_zips)))
  and public.icash_inventory_scope_allowed(p_account,zip)
  and not exists(select 1 from icash_research_private.stalled_searches q where q.account_id=p_account and q.zip=icash_inventory_markets.zip)
  order by priority,md5(zip||p_account::text) limit 64) candidates
   join public.icash_inventory_markets using(account_id,zip) order by (select count(*) from public.icash_discovery_configs other where other.zip=icash_inventory_markets.zip and other.account_id<>p_account and other.enabled and not other.exhausted),
   public.icash_opportunity_market_score(p_account,zip) desc,priority,zip for update of icash_inventory_markets skip locked limit 1;
 if not found then return false;end if;
 insert into icash_research_private.stalled_searches(operation_key,account_id,request_id,zip,configuration)
 values(op,p_account,r.id,c.zip,to_jsonb(c));
 -- A different ZIP is disjoint from the uncertain original search. No operation,
 -- receipt, charge or reservation is reset, released, marked failed or replayed.
 update public.icash_discovery_configs set zip=m.zip,revision=gen_random_uuid(),next_page=1,
  research_list_id=null,exhausted=false,next_run_at=now() where account_id=p_account;
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $function$;
