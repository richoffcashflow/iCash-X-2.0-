-- Prospective bystander continuation only. Never settle, release or replay a search.
-- Caller owns the migration transaction so schema changes and receipt are atomic.
set local lock_timeout='5s';
set local statement_timeout='60s';
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure))<>'9b2533d4bdce4637b10f6b999e4669c6'
  or md5(pg_get_functiondef('public.icash_targeting_query_context(uuid,uuid,integer)'::regprocedure))<>'9bffc2449a8ee74b66aba65ae7d2a1cb'
  or md5(pg_get_functiondef('public.icash_inventory_scope_allowed(uuid,text)'::regprocedure))<>'616cec64ff301be8378542a3d81e5d3f'
  or md5(pg_get_functiondef('icash_research_private.financial_capable()'::regprocedure))<>'4b5ae548ff0b2e0e60c2bf41ce7b9648'
 then raise exception 'Market hold continuation prerequisite changed';end if;
end $guard$;
create table icash_research_private.market_hold_continuation_settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),activated_at timestamptz,
 check(not enabled or (release_sha is not null and activated_at is not null))
);
insert into icash_research_private.market_hold_continuation_settings(id) values(1);
create table icash_research_private.market_hold_continuations(
 account_id uuid not null references public.icash_accounts(id),revision uuid not null,page integer not null,
 original_configuration jsonb not null,next_configuration jsonb not null,
 blocked_zips text[] not null,blocking_operations jsonb not null,
 continued_at timestamptz not null default now(),primary key(account_id,revision,page)
);
alter table icash_research_private.market_hold_continuation_settings enable row level security;
alter table icash_research_private.market_hold_continuations enable row level security;
revoke all on icash_research_private.market_hold_continuation_settings,icash_research_private.market_hold_continuations from public,anon,authenticated,service_role;

create function public.icash_continue_held_inventory(p_account uuid,p_revision uuid,p_page integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;m public.icash_inventory_markets;next_config jsonb;
 q icash_research_private.targeting_query_settings;e icash_research_private.exclusions;
 blocked text[];unscoped boolean;operations jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision is distinct from p_revision or c.next_page is distinct from p_page
  or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now()
  or c.research_version<>2 or c.research_list_id is not null then return false;end if;
 perform 1 from icash_research_private.market_hold_continuation_settings where id=1 and enabled for share;
 if not found then return false;end if;
 perform 1 from icash_research_private.financial_settings where id=1 and enabled for share;
 if not found or not icash_research_private.financial_capable() then return false;end if;
 -- Lock existing permission rows and use the canonical per-ZIP scope predicate.
 -- Its existing missing-setup default is unrestricted, not a new permission grant.
 perform 1 from public.icash_bot_setups where account_id=p_account for share;
 if exists(select 1 from public.icash_bot_setups where account_id=p_account
   and coalesce(profile->>'marketMode','nationwide')<>'nationwide')
  or not public.icash_inventory_scope_allowed(p_account,c.zip) then return false;end if;
 if not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='property_search' and enabled and expires_at>now())
  -- Own unknowns need their separate source-bound continuation, never this path.
  or exists(select 1 from public.icash_operation_spend where account_id=p_account
   and operation_key like 'discovery:%' and state not in ('settled','cancelled'))
  or (select count(*) from public.icash_automation_tickets where account_id=p_account and kind='discovery'
   and ((state='issued' and expires_at>now()) or (state='consumed' and greatest(created_at,expires_at)>now()-interval '5 minutes'))) > 1
  then return false;end if;
 select * into q from icash_research_private.targeting_query_settings where id=1 for share;
 select * into e from icash_research_private.exclusions where id=1 for share;
 if not coalesce(q.enabled and e.state='ready' and e.list_id=q.list_id
  and e.last_synced_at is not null and e.last_synced_at<=now()
  and not exists(select 1 from icash_research_private.exclusion_items where synced_at is null)
  and not exists(select 1 from icash_research_private.targeting_acquired_properties where synced_at is null),false)
  then return false;end if;
 -- Resolve the exact canonical source-bound scope ONCE, never once per market.
 with unresolved as materialized (
  select o.operation_key,o.account_id,scopes.zips from public.icash_operation_spend o
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
 ), geography as (
  select distinct z.zip from unresolved u cross join lateral unnest(u.zips) z(zip)
 )
 select coalesce((select bool_or(cardinality(zips)=0) from unresolved),false),
  array(select zip from geography order by zip),
  coalesce((select jsonb_agg(jsonb_build_object('operationKey',operation_key,'accountId',account_id,'zips',zips) order by operation_key) from unresolved),'[]'::jsonb)
 into unscoped,blocked,operations;
 if unscoped or not (c.zip=any(blocked)) then return false;end if;
 select im.* into m from (
  select account_id,zip from public.icash_inventory_markets
  where account_id=p_account and zip<>c.zip and eligible_until>now() and next_scan_at<=now()
   and not (zip=any(blocked)) and public.icash_research_zip_known(zip)
   and public.icash_inventory_scope_allowed(p_account,zip) and not public.icash_stalled_research_zip(p_account,zip)
  order by priority,md5(zip||p_account::text) limit 64
 ) candidates join public.icash_inventory_markets im using(account_id,zip)
 order by (select count(*) from public.icash_discovery_configs other where other.zip=im.zip
  and other.account_id<>p_account and other.enabled and not other.exhausted),
  public.icash_opportunity_market_score(p_account,im.zip) desc,im.priority,im.zip
 for update of im skip locked limit 1;
 if not found or not public.icash_inventory_scope_allowed(p_account,m.zip)
  or m.eligible_until<=now() or m.next_scan_at>now() then return false;end if;
 -- No provider request, inventory-empty assertion, financial change or historical
 -- rewrite. Old workers must fail the unchanged final exact-revision admission.
 update public.icash_discovery_configs set zip=m.zip,revision=gen_random_uuid(),next_page=1,next_run_at=now()
 where account_id=p_account returning to_jsonb(icash_discovery_configs) into next_config;
 insert into icash_research_private.market_hold_continuations(account_id,revision,page,original_configuration,next_configuration,blocked_zips,blocking_operations)
 values(p_account,c.revision,c.next_page,to_jsonb(c),next_config,blocked,operations);
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $$;
revoke all on function public.icash_continue_held_inventory(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_continue_held_inventory(uuid,uuid,integer) to service_role;

do $patch$
declare source text:=pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure);
 needle text:=$old$  return case when public.icash_targeting_query_context(p_account,p_revision,p_page)->'ready'='true'::jsonb then 'ready' else 'inventory_held' end;$old$;
begin
 if strpos(source,needle)=0 then raise exception 'Market hold continuation insertion changed';end if;
 execute replace(source,needle,$new$  if public.icash_targeting_query_context(p_account,p_revision,p_page)->'ready'='true'::jsonb then return 'ready';end if;
  if public.icash_continue_held_inventory(p_account,p_revision,p_page) then return 'inventory_market_changed';end if;
  return 'inventory_held';$new$);
end $patch$;
