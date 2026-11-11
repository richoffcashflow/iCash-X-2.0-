-- Spread successful research across authorized markets without buying a test page.
-- Caller owns the migration transaction so schema and history stay atomic.
set local lock_timeout='5s';
set local statement_timeout='60s';
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure))<>'28d5e809b3ffd39089ef7a858d40ef0e'
 then raise exception 'Install reviewed market hold continuation before diversity';end if;
end $guard$;
create table icash_research_private.market_diversity_settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),activated_at timestamptz,
 check(not enabled or (release_sha is not null and activated_at is not null))
);
insert into icash_research_private.market_diversity_settings(id) values(1);
create table icash_research_private.market_diversity_rotations(
 account_id uuid not null,revision uuid not null,page integer not null,
 original_configuration jsonb not null,next_configuration jsonb not null,
 rotated_at timestamptz not null default now(),primary key(account_id,revision,page)
);
alter table icash_research_private.market_diversity_settings enable row level security;
alter table icash_research_private.market_diversity_rotations enable row level security;
revoke all on icash_research_private.market_diversity_settings,icash_research_private.market_diversity_rotations from public,anon,authenticated,service_role;
create index if not exists icash_inventory_receipts_account_recent
 on public.icash_discovery_inventory_receipts(account_id,created_at desc);

create function public.icash_rotate_successful_market(p_account uuid,p_revision uuid,p_page integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;m record;blocked text[];unknown_scope boolean;next_config jsonb;
begin
 -- Keep the normal lock order. Never move a configuration backing unfinished work.
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account for update;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision is distinct from p_revision or c.next_page is distinct from p_page or c.exhausted
  or not c.enabled or not c.auto_enabled or c.data_rights_until<=now()
  or c.research_version is distinct from 2 or c.research_list_id is not null
  or not public.icash_membership_work_allowed(p_account)
  or not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
    where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents)
  or exists(select 1 from public.icash_operation_spend o where o.account_id=p_account
    and o.operation_key like 'discovery:%' and o.state not in ('settled','cancelled')) then return false;end if;
 perform 1 from icash_research_private.market_diversity_settings where id=1 and enabled for share;
 if not found then return false;end if;
 perform 1 from public.icash_bot_setups where account_id=p_account for share;
 if not public.icash_inventory_scope_allowed(p_account,c.zip)
  or not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='property_search' and enabled and expires_at>now())
  or (select count(*) from public.icash_automation_tickets where account_id=p_account and kind='discovery'
    and ((state='issued' and expires_at>now()) or (state='consumed' and greatest(created_at,expires_at)>now()-interval '5 minutes')))>1 then return false;end if;
 -- Two completed, productive pages are a bounded research turn, not a claim of
 -- financial eligibility or permission to contact any of their properties.
 if (select count(*) from (select r.operation_key from public.icash_discovery_inventory_receipts r
   join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id and o.state='settled'
   where r.account_id=p_account and r.revision=p_revision and r.zip=c.zip and r.queued_properties>0
   order by r.created_at desc limit 2) successful)<2 then return false;end if;
 if public.icash_targeting_query_context(p_account,p_revision,p_page)->'ready' is distinct from 'true'::jsonb then return false;end if;

 -- Resolve unknown paid scopes once, using the same source hierarchy as final
 -- targeting admission. No identity, purchase or hold is cleared by rotation.
 with unresolved as materialized (
  select scopes.zips from public.icash_operation_spend o
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
 ) select coalesce(bool_or(cardinality(zips)=0),false),
   array(select distinct unnest(zips) from unresolved) into unknown_scope,blocked from unresolved;
 if unknown_scope then return false;end if;

 with recent as materialized (
  select r.zip from public.icash_discovery_inventory_receipts r
  where r.account_id=p_account and r.queued_properties>0 and r.created_at>now()-interval '30 days'
  order by r.created_at desc limit 32
 ), candidates as materialized (
  select im.account_id,im.zip,g.state_code,g.name
  from public.icash_inventory_markets im join public.icash_property_zip_geographies g on g.zip=im.zip
  where im.account_id=p_account and im.zip<>c.zip and im.eligible_until>now() and im.next_scan_at<=now()
   and not(im.zip=any(blocked)) and g.property_count>0 and g.checked_at<=now() and g.expires_at>now()
   and public.icash_research_state_allowed(g.state_code) and public.icash_research_zip_known(im.zip)
   and public.icash_inventory_scope_allowed(p_account,im.zip) and not public.icash_stalled_research_zip(p_account,im.zip)
  -- Prefer another city before the 64-row bound; otherwise a dense city's ZIPs
  -- could fill the entire candidate set. Explicit city restrictions still win.
  order by case when exists(select 1 from public.icash_property_zip_geographies old
    where old.zip=c.zip and old.state_code=g.state_code and lower(trim(old.name))=lower(trim(g.name))) then 1 else 0 end,
   im.priority,md5(im.zip||p_account::text) limit 64
 ) select im.zip,im.eligible_until,im.next_scan_at into m from candidates k join public.icash_inventory_markets im using(account_id,zip)
 order by (select count(*) from recent r join public.icash_property_zip_geographies g on g.zip=r.zip
   where g.state_code=k.state_code and lower(trim(g.name))=lower(trim(k.name))),
  (select count(*) from recent r where r.zip=k.zip),
  (select count(*) from public.icash_discovery_configs other where other.zip=k.zip
    and other.account_id<>p_account and other.enabled and not other.exhausted),
  public.icash_opportunity_market_score(p_account,k.zip) desc,im.priority,md5(k.zip||p_account::text)
 for update of im skip locked limit 1;
 if not found or m.eligible_until<=now() or m.next_scan_at>now()
  or not public.icash_inventory_scope_allowed(p_account,m.zip) then return false;end if;
 -- Preserve the productive current configuration if there is no safe alternative.
 -- Old pages, original costs and exclusion receipts are intentionally immutable.
 update public.icash_inventory_markets set next_scan_at=greatest(next_scan_at,now()+interval '30 days')
  where account_id=p_account and zip in(c.zip,m.zip);
 update public.icash_discovery_configs set zip=m.zip,next_page=1,revision=gen_random_uuid(),exhausted=false,next_run_at=now()
  where account_id=p_account returning to_jsonb(icash_discovery_configs) into next_config;
 insert into icash_research_private.market_diversity_rotations(account_id,revision,page,original_configuration,next_configuration)
 values(p_account,c.revision,c.next_page,to_jsonb(c),next_config);
 return true;
end $$;
revoke all on function public.icash_rotate_successful_market(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_rotate_successful_market(uuid,uuid,integer) to service_role;

-- Insert before normal preparation. The helper independently checks all guards;
-- a false result leaves every existing ready/held/exhaustion branch unchanged.
do $patch$
declare d text;needle text:=' perform public.icash_expand_inventory_markets(p_account);';
begin
 d:=pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Inventory preparation changed';end if;
 execute replace(d,needle,needle||E'\n if public.icash_rotate_successful_market(p_account,p_revision,p_page) then return ''inventory_market_changed'';end if;');
end $patch$;
