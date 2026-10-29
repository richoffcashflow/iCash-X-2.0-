-- Skip blocked searches before any provider request; reuse exact free estimates.
-- This migration never starts a purchase, changes quota counters or replays a hold.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table icash_research_private.estimates(
 operation_key text primary key, account_id uuid not null references public.icash_accounts(id),
 query jsonb not null, exclusion_synced_at timestamptz, token uuid,
 lease_until timestamptz, retry_at timestamptz, response jsonb, saved_at timestamptz,
 updated_at timestamptz not null default now()
);
create index research_estimates_account on icash_research_private.estimates(account_id);
create index research_estimates_updated on icash_research_private.estimates(updated_at);
alter table icash_research_private.estimates enable row level security;
revoke all on icash_research_private.estimates from public,anon,authenticated,service_role;

create function public.icash_research_query_ready(p_account uuid,p_scope jsonb,p_plan jsonb,p_policy jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare c public.icash_discovery_configs;s public.icash_bot_setups;r public.icash_operation_rates;op text;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account;
 select * into s from public.icash_bot_setups where account_id=p_account;
 select * into r from public.icash_operation_rates where id=c.rate_id;
 if c.account_id is null or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now()
  or row(c.zip,c.revision,c.next_page,c.per_page,c.rate_id,c.property_credit_micros,c.data_rights_until)
   is distinct from row(p_scope->>'p_zip',(p_scope->>'p_revision')::uuid,(p_scope->>'p_page')::integer,
    (p_scope->>'p_per_page')::integer,(p_scope->>'p_rate')::uuid,(p_scope->>'p_unit')::bigint,(p_scope->>'p_permission_until')::timestamptz)
  or row(s.revision,s.profile->>'marketMode',s.profile->>'market') is distinct from
   row((p_scope->>'p_setup_revision')::integer,p_scope->>'p_market_mode',p_scope->>'p_market')
  or not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
   where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents)
  or not public.icash_membership_work_allowed(p_account)
  or r.operation is distinct from 'property_search' or not coalesce(r.enabled,false) or r.expires_at<=now()
  or not public.icash_research_zip_known(c.zip) or public.icash_stalled_research_zip(p_account,c.zip)
  or not coalesce(public.icash_outbound_search_due(p_account),false) then return false;end if;
 if (c.research_version=0 and p_policy is not null)
  or (c.research_version in (1,2) and p_policy is distinct from jsonb_build_object('version',
   case when c.research_version=2 then 'research-efficiency-v2' else 'research-efficiency-v1' end,'exclusionListId',c.research_list_id))
  or (c.research_list_id is not null and exists(select 1 from icash_research_private.exclusion_items where synced_at is null)) then return false;end if;
 op:='discovery:'||p_account||':'||c.revision||':'||c.next_page;
 if exists(select 1 from public.icash_operation_spend where operation_key=op and state<>'reserved') then return false;end if;
 if p_plan is not null then
  if not public.icash_discovery_filter_plan_valid(p_plan)
   or not exists(select 1 from public.icash_discovery_filter_settings where id=1 and enabled)
   or exists(select 1 from public.icash_discovery_filter_pages where operation_key=op)
   or not exists(select 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=c.revision
    and zip=c.zip and strategy=p_plan->>'strategy' and next_page=(p_plan->>'providerPage')::integer and not exhausted)
   or exists(select 1 from public.icash_discovery_filter_pages fp
    join public.icash_operation_spend os using(operation_key,account_id)
    join public.icash_discovery_configs dc on dc.account_id=fp.account_id
    where fp.zip=c.zip and fp.plan->>'strategy'=p_plan->>'strategy' and fp.plan->>'providerPage'=p_plan->>'providerPage'
     and dc.per_page=c.per_page and fp.state='claimed' and os.state not in ('settled','cancelled')) then return false;end if;
 end if;
 return true;
end $$;

create function public.icash_claim_discovery_estimate(p_account uuid,p_scope jsonb,p_plan jsonb,p_policy jsonb,p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e icash_research_private.estimates;op text;generation timestamptz;t uuid:=gen_random_uuid();
begin
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>16384
  or p_query->'estimate_cost' is distinct from 'true'::jsonb or p_query->>'contact_audience' is distinct from 'none'
  or p_query->>'anchor' is distinct from 'properties' then return jsonb_build_object('status','held');end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_discovery_configs where account_id=p_account for update;
 if not public.icash_research_query_ready(p_account,p_scope,p_plan,p_policy) then return jsonb_build_object('status','held');end if;
 op:='discovery:'||p_account||':'||(p_scope->>'p_revision')||':'||(p_scope->>'p_page');
 if p_policy->>'exclusionListId' is not null then
  select last_synced_at into generation from icash_research_private.exclusions where id=1 and list_id=p_policy->>'exclusionListId';
  if generation is null then return jsonb_build_object('status','held');end if;
 end if;
 insert into icash_research_private.estimates(operation_key,account_id,query,exclusion_synced_at)
 values(op,p_account,p_query,generation) on conflict do nothing;
 select * into e from icash_research_private.estimates where operation_key=op and account_id=p_account for update;
 if not found or e.lease_until>now() then return jsonb_build_object('status','held');end if;
 if e.query=p_query and e.exclusion_synced_at is not distinct from generation then
  if e.response is not null and e.saved_at>now()-interval '5 minutes' then return jsonb_build_object('status','cached','response',e.response);end if;
  if e.retry_at>now() then return jsonb_build_object('status','held');end if;
 end if;
 update icash_research_private.estimates set query=p_query,exclusion_synced_at=generation,token=t,
  lease_until=now()+interval '1 minute',retry_at=null,response=null,saved_at=null,updated_at=now() where operation_key=op;
 return jsonb_build_object('status','request','token',t);
end $$;

create function public.icash_finish_discovery_estimate(p_account uuid,p_token uuid,p_response jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare e icash_research_private.estimates;valid boolean;
begin
 select * into e from icash_research_private.estimates where account_id=p_account and token=p_token for update;
 if not found or e.lease_until<=now() then return false;end if;
 valid:=jsonb_typeof(p_response)='object' and octet_length(p_response::text)<=65536
  and jsonb_typeof(p_response->'estimated_credits'->'this_page')='number'
  and (p_response->'estimated_credits'->>'this_page') ~ '^[0-9]{1,2}$'
  and case when (p_response->'estimated_credits'->>'this_page') ~ '^[0-9]{1,2}$'
   and (e.query->>'per_page') ~ '^[0-9]{1,2}$' then
    (p_response->'estimated_credits'->>'this_page')::integer between 0 and (e.query->>'per_page')::integer else false end
  and p_response->'estimated_credits'->'breakdown'->'people'='0'::jsonb;
 update icash_research_private.estimates set token=null,lease_until=null,
  response=case when valid then p_response end,saved_at=case when valid then now() end,
  retry_at=case when not coalesce(valid,false) then now()+interval '2 minutes' end,updated_at=now()
  where operation_key=e.operation_key;
 return coalesce(valid,false);
end $$;

-- A static query can reuse only its own version, ZIP, strategy, page and size.
-- Mutable exclusion-list pages deliberately never enter this cache.
create function public.icash_known_assigned_research_page(p_zip text,p_strategy text,p_page integer,p_size integer,p_policy jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('hasNextPage',r.has_next_page) from public.icash_discovery_inventory_receipts r
 where p_policy->>'exclusionListId' is null and r.query_policy is not distinct from p_policy
  and r.zip=p_zip and r.strategy=p_strategy and r.provider_page=p_page and r.per_page=p_size
  and r.created_at>now()-interval '7 days'
  and not exists(select 1 from unnest(r.property_ids) id where not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=id))
 order by r.created_at desc limit 1;
$$;

-- An unresolved page blocks only that candidate. Keep other reviewed query
-- arms available without clearing or buying over the original unknown claim.
alter function public.icash_discovery_filter_state_v2(uuid,uuid,integer) rename to icash_filter_state_before_request_reuse;
create function public.icash_discovery_filter_state_v2(p_account uuid,p_revision uuid,p_page integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source jsonb;c public.icash_discovery_configs;
begin
 source:=public.icash_filter_state_before_request_reuse(p_account,p_revision,p_page);
 if source is null then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 return (select jsonb_agg(item||jsonb_build_object('blocked',exists(
  select 1 from public.icash_discovery_filter_pages fp
  join public.icash_operation_spend os using(operation_key,account_id)
  join public.icash_discovery_configs dc on dc.account_id=fp.account_id
  where fp.zip=c.zip and fp.plan->>'strategy'=item->>'strategy'
   and fp.plan->>'providerPage'=item->>'nextPage' and dc.per_page=c.per_page
   and fp.state='claimed' and os.state not in ('settled','cancelled')
 ))) from jsonb_array_elements(source) item);
end $$;

do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure);
 old:='if c.research_version in (1,2) then return ''ready'';end if;';
 if strpos(d,old)=0 then raise exception 'Research inventory prerequisite changed';end if;
 d:=replace(d,old,'if c.research_list_id is not null then return ''ready'';end if;');
 old:='cached:=public.icash_known_assigned_discovery_page(c.zip,cur.strategy,cur.next_page,c.per_page);';
 if strpos(d,old)=0 then raise exception 'Research cache prerequisite changed';end if;
 execute replace(d,old,'cached:=public.icash_known_assigned_research_page(c.zip,cur.strategy,cur.next_page,c.per_page,
  case when c.research_version in (1,2) then jsonb_build_object(''version'',case when c.research_version=2 then ''research-efficiency-v2'' else ''research-efficiency-v1'' end,''exclusionListId'',null) end);');
 -- Do not synchronize an unused provider list. Pending IDs stay durable for
 -- a separately verified restoration of exclusion queries.
 d:=pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure);
 old:='where id=1 and enabled)';
 if strpos(d,old)=0 then raise exception 'Exclusion claim prerequisite changed';end if;
 execute replace(d,old,'where id=1 and enabled and exclusions_enabled)');
 -- Estimate metadata is disposable after a day. Prune in bounded batches
 -- alongside existing diagnostics, without touching paid claims or receipts.
 d:=pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure);
 old:='delete from icash_research_private.requests';
 if strpos(d,old)=0 then raise exception 'Research pruning prerequisite changed';end if;
 execute replace(d,old,'delete from icash_research_private.estimates where operation_key in (
  select operation_key from icash_research_private.estimates where updated_at<now()-interval ''1 day''
   and (lease_until is null or lease_until<=now()) order by updated_at limit 1000 for update skip locked);
 '||old);
end $patch$;

revoke all on function public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb),public.icash_claim_discovery_estimate(uuid,jsonb,jsonb,jsonb,jsonb),public.icash_finish_discovery_estimate(uuid,uuid,jsonb),public.icash_known_assigned_research_page(text,text,integer,integer,jsonb),public.icash_discovery_filter_state_v2(uuid,uuid,integer),public.icash_filter_state_before_request_reuse(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb),public.icash_claim_discovery_estimate(uuid,jsonb,jsonb,jsonb,jsonb),public.icash_finish_discovery_estimate(uuid,uuid,jsonb),public.icash_known_assigned_research_page(text,text,integer,integer,jsonb),public.icash_discovery_filter_state_v2(uuid,uuid,integer),public.icash_filter_state_before_request_reuse(uuid,uuid,integer) to service_role;
commit;
