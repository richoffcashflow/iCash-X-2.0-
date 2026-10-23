-- Assignment-aware discovery, free geographic expansion and customer protection.
-- Provider receipts and historical charges remain immutable. No paid requests run here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.icash_discovery_inventory_receipts(
 operation_key text primary key references public.icash_discovery_results(operation_key),
 account_id uuid not null references public.icash_accounts(id),revision uuid not null,
 zip text not null,strategy text not null,provider_page integer not null,
 per_page integer not null check(per_page between 1 and 10),
 property_ids text[] not null,returned_properties integer not null,
 queued_properties integer not null,duplicate_properties integer not null,
 has_next_page boolean not null,created_at timestamptz not null,
 check(returned_properties=cardinality(property_ids)),
 check(queued_properties between 0 and returned_properties),
 check(duplicate_properties between 0 and returned_properties)
);
create index icash_discovery_inventory_lookup on public.icash_discovery_inventory_receipts(zip,strategy,provider_page,per_page,created_at desc);
create index icash_discovery_inventory_account on public.icash_discovery_inventory_receipts(account_id,revision,created_at desc);
alter table public.icash_discovery_inventory_receipts enable row level security;
revoke all on public.icash_discovery_inventory_receipts from public,anon,authenticated;
grant select,insert on public.icash_discovery_inventory_receipts to service_role;
alter table public.icash_discovery_configs add column inventory_refreshed_at timestamptz;
alter table public.icash_discovery_filter_cursors add column skipped_assigned_pages integer not null default 0 check(skipped_assigned_pages>=0);

create function public.icash_record_discovery_inventory() returns trigger language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;ids text[];queued integer;duplicates integer;plan jsonb;
begin
 select * into strict c from public.icash_discovery_configs where account_id=new.account_id;
 select coalesce(array_agg(value->>'dm_property_id'),'{}') into ids from jsonb_array_elements(new.result->'rows');
 select count(*) into queued from public.icash_screening_jobs s where s.account_id=new.account_id
 and s.event_key in (select new.operation_key||':'||id from unnest(ids) id);
 select count(*) into duplicates from unnest(ids) id join public.icash_outbound_property_owners o on o.property_id=id
 where not exists(select 1 from public.icash_screening_jobs s where s.account_id=new.account_id and s.event_key=new.operation_key||':'||id);
 plan:=new.result->'filterPlan';
 insert into public.icash_discovery_inventory_receipts(operation_key,account_id,revision,zip,strategy,provider_page,per_page,property_ids,returned_properties,queued_properties,duplicate_properties,has_next_page,created_at)
 values(new.operation_key,new.account_id,c.revision,c.zip,coalesce(plan->>'strategy','baseline'),coalesce((plan->>'providerPage')::integer,c.next_page),c.per_page,ids,cardinality(ids),queued,duplicates,(new.result->>'hasNextPage')::boolean,new.created_at);
 return new;
end $$;
create trigger icash_discovery_inventory_receipt after insert on public.icash_discovery_results for each row execute function public.icash_record_discovery_inventory();

-- Old filtered receipts contain the exact query arm/page. Only complete five-row
-- pages are safe to infer for the existing five-record production configuration.
insert into public.icash_discovery_inventory_receipts
select r.operation_key,r.account_id,p.revision,p.zip,p.plan->>'strategy',(p.plan->>'providerPage')::integer,5,
 array(select value->>'dm_property_id' from jsonb_array_elements(r.result->'rows')),
 jsonb_array_length(r.result->'rows'),
 (select count(*) from public.icash_screening_jobs s where s.account_id=r.account_id and s.event_key in (select r.operation_key||':'||(value->>'dm_property_id') from jsonb_array_elements(r.result->'rows'))),
 (select count(*) from jsonb_array_elements(r.result->'rows') row join public.icash_outbound_property_owners o on o.property_id=row->>'dm_property_id'
  where not exists(select 1 from public.icash_screening_jobs s where s.account_id=r.account_id and s.event_key=r.operation_key||':'||(row->>'dm_property_id'))),
 (r.result->>'hasNextPage')::boolean,r.created_at
from public.icash_discovery_results r join public.icash_discovery_filter_pages p using(operation_key,account_id)
join public.icash_discovery_configs c using(account_id)
where p.state='complete' and c.per_page=5 and jsonb_array_length(r.result->'rows')=5 and r.created_at>now()-interval '30 days'
on conflict do nothing;

create function public.icash_discovery_no_new_inventory(p_account uuid,p_operation text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_discovery_inventory_receipts d
 join public.icash_operation_spend o using(operation_key,account_id) join public.icash_operation_rates r on r.id=o.rate_id
 where d.account_id=p_account and d.operation_key=p_operation and r.operation='property_search'
 and d.queued_properties=0 and d.returned_properties=d.duplicate_properties);
$$;

-- Preserve the full cost manifest, but the platform covers a confirmed duplicate
-- or empty page. This occurs in the same transaction as the usage debit.
do $patch$
declare d text;needle text:='covered:=greatest(0,p_charge-available);';
begin
 d:=pg_get_functiondef('public.icash_finish_credit(uuid,text,bigint,text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Credit settlement boundary changed';end if;
 d:=replace(d,needle,'covered:=case when public.icash_discovery_no_new_inventory(p_account,p_operation) then p_charge else greatest(0,p_charge-available) end;');
 d:=replace(d,'Platform-covered concurrent usage; no customer debt: ','Platform-covered usage; no customer debt: ');
 execute d;
end $patch$;

-- A bounded, evidence-backed correction for a previously settled duplicate page.
-- The original receipt, usage ledger entry and cost snapshot are never rewritten.
create function public.icash_credit_duplicate_discovery(p_account uuid,p_operation text) returns bigint language plpgsql set search_path='' as $$
declare o public.icash_operation_spend;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where account_id=p_account and operation_key=p_operation for update;
 if not found or o.state<>'settled' or coalesce(o.charged_cents,0)<=0 or not public.icash_discovery_no_new_inventory(p_account,p_operation)
 or exists(select 1 from public.icash_usage_coverage where operation_key=p_operation)
 or not exists(select 1 from public.icash_credit_ledger where account_id=p_account and event_key='usage:'||p_operation and kind='usage' and delta_cents=-o.charged_cents) then return 0;end if;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing';end if;
 insert into public.icash_usage_coverage(operation_key,account_id,gross_cents,customer_cents,covered_cents,evidence_ref)
 values(p_operation,p_account,o.charged_cents,0,o.charged_cents,'Duplicate inventory correction: '||p_operation);
 insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
 values(p_account,'usage-coverage:'||p_operation,'grant',o.charged_cents,'Duplicate inventory correction; no new property delivered: '||p_operation);
 update public.icash_wallets set balance_cents=balance_cents+o.charged_cents where account_id=p_account;
 return o.charged_cents;
end $$;

create function public.icash_customer_discovery_charge(p_account uuid,p_operation text,p_gross bigint) returns bigint language sql stable set search_path='' as $$
 select case when public.icash_discovery_no_new_inventory(p_account,p_operation)
 then greatest(0,p_gross-coalesce((select covered_cents from public.icash_usage_coverage where operation_key=p_operation and account_id=p_account),0)) else p_gross end;
$$;
create function public.icash_inventory_scope_allowed(p_account uuid,p_zip text) returns boolean language sql stable set search_path='' as $$
 select coalesce((select coalesce(case when coalesce(s.profile->>'marketMode','nationwide')='nationwide' then true
 else p_zip=trim(s.profile->>'market') or exists(select 1 from public.icash_market_shortlist m where m.zip=p_zip and lower(trim(s.profile->>'market')) in (lower(m.city),lower(m.city||', '||m.state))) end,false)
 from public.icash_bot_setups s where s.account_id=p_account),true);
$$;
-- Covered duplicate work must not consume the customer's fixed search allowance.
-- Funding snapshots, release timing and unresolved authorizations stay unchanged.
do $patch$
declare d text;name text;
begin
 foreach name in array array['icash_prospecting_available','icash_prospecting_total_available'] loop
  d:=pg_get_functiondef(('public.'||name||'(uuid)')::regprocedure);
  if position('then o.charged_cents' in d)=0 then raise exception 'Prospecting charge boundary changed';end if;
  execute replace(d,'then o.charged_cents','then public.icash_customer_discovery_charge(o.account_id,o.operation_key,o.charged_cents)');
 end loop;
 d:=pg_get_functiondef('public.icash_prospecting_progress(uuid)'::regprocedure);
 if position('sum(charged_cents)' in d)=0 then raise exception 'Progress charge boundary changed';end if;
 execute replace(d,'sum(charged_cents)','sum(public.icash_customer_discovery_charge(account_id,operation_key,charged_cents))');
 -- Spread newly rotated searches across active accounts before comparing outcomes.
 d:=pg_get_functiondef('public.icash_rotate_inventory_market(uuid)'::regprocedure);
 if position('order by public.icash_opportunity_market_score(p_account,zip)' in d)=0 then raise exception 'Market rotation boundary changed';end if;
 d:=replace(d,'public.icash_research_zip_known(zip)','public.icash_research_zip_known(zip) and public.icash_inventory_scope_allowed(p_account,zip)');
 execute replace(d,'order by public.icash_opportunity_market_score(p_account,zip)',
 'order by (select count(*) from public.icash_discovery_configs other where other.zip=icash_inventory_markets.zip and other.account_id<>p_account and other.enabled and not other.exhausted),public.icash_opportunity_market_score(p_account,zip)');
end $patch$;

-- Metadata is shared geography, not another customer's leads or conversations.
insert into public.icash_property_zip_geographies(zip,state_code,name,property_count,source_ref,checked_at,expires_at)
select distinct on(zip) zip,state,city,total_properties,'https://api.v2.dealmachine.com/v1/properties/search/count; ZIP '||zip,checked_at,checked_at+interval '30 days'
from public.icash_market_research_results where checked_at>now()-interval '30 days' and high_equity_properties>0 and public.icash_research_state_allowed(state)
order by zip,checked_at desc on conflict(zip) do nothing;

create function public.icash_expand_inventory_markets(p_account uuid) returns integer language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;profile jsonb;n integer;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.auto_enabled or c.data_rights_until<=now() or c.inventory_refreshed_at>now()-interval '10 minutes' then return 0;end if;
 select s.profile into profile from public.icash_bot_setups s where s.account_id=p_account;
 -- Never widen an explicit city/ZIP restriction or alter the user's saved setup.
 if coalesce(profile->>'marketMode','nationwide')<>'nationwide' then return 0;end if;
 insert into public.icash_inventory_markets(account_id,zip,priority,eligible_until)
 select p_account,g.zip,100,least(c.data_rights_until,g.expires_at)
 from public.icash_property_zip_geographies g where g.property_count>0 and g.checked_at<=now() and g.expires_at>now() and public.icash_research_state_allowed(g.state_code)
 order by case when g.property_count>=1000 then 0 else 1 end,md5(g.zip||p_account::text) limit 200
 on conflict(account_id,zip) do update set eligible_until=greatest(public.icash_inventory_markets.eligible_until,excluded.eligible_until);
 get diagnostics n=row_count;
 update public.icash_discovery_configs set inventory_refreshed_at=now() where account_id=p_account;
 return n;
end $$;

-- Consult saved query receipts before another provider lookup. Only opaque IDs
-- are inspected; property payloads and customer activity never cross accounts.
create function public.icash_known_assigned_discovery_page(p_zip text,p_strategy text,p_page integer,p_size integer)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('hasNextPage',r.has_next_page) from public.icash_discovery_inventory_receipts r
 where r.zip=p_zip and r.strategy=p_strategy and r.provider_page=p_page and r.per_page=p_size and r.created_at>now()-interval '7 days'
 and not exists(select 1 from unnest(r.property_ids) id where not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=id))
 order by r.created_at desc limit 1;
$$;

create function public.icash_prepare_discovery_inventory(p_account uuid,p_revision uuid,p_page integer) returns text language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;cur record;cached jsonb;n integer:=0;streak integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision<>p_revision or c.next_page<>p_page or not c.enabled or not c.auto_enabled or c.data_rights_until<=now()
 or not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents)
 or not public.icash_membership_work_allowed(p_account) then return 'inventory_held';end if;
 if exists(select 1 from public.icash_operation_spend where operation_key='discovery:'||p_account||':'||p_revision||':'||p_page and state<>'reserved') then return 'awaiting_reconciliation';end if;
 perform public.icash_expand_inventory_markets(p_account);
 select count(*) into streak from (select queued_properties,returned_properties,duplicate_properties from public.icash_discovery_inventory_receipts where account_id=p_account and revision=p_revision order by created_at desc limit 3) recent
 where queued_properties=0 and returned_properties=duplicate_properties;
 if streak=3 then
  update public.icash_inventory_markets set next_scan_at=greatest(next_scan_at,now()+interval '6 hours') where account_id=p_account and zip=c.zip;
  update public.icash_discovery_configs set exhausted=true where account_id=p_account;
  if public.icash_rotate_inventory_market(p_account) then return 'inventory_market_changed';end if;
  return 'inventory_waiting';
 end if;
 if not exists(select 1 from public.icash_discovery_filter_settings where id=1 and enabled) then return 'ready';end if;
 perform public.icash_discovery_filter_state_v2(p_account,p_revision,p_page);
 for cur in select * from public.icash_discovery_filter_cursors where account_id=p_account and revision=p_revision and not exhausted order by strategy for update loop
  loop
   cached:=public.icash_known_assigned_discovery_page(c.zip,cur.strategy,cur.next_page,c.per_page);
   exit when cached is null;
   update public.icash_discovery_filter_cursors set next_page=next_page+1,skipped_assigned_pages=skipped_assigned_pages+1,exhausted=not (cached->>'hasNextPage')::boolean
   where account_id=p_account and revision=p_revision and strategy=cur.strategy;
   cur.next_page:=cur.next_page+1;n:=n+1;
   if n>=64 then return 'inventory_advancing';end if;
   exit when not (cached->>'hasNextPage')::boolean;
  end loop;
 end loop;
 if not exists(select 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=p_revision and not exhausted) then
  perform public.icash_mark_inventory_empty(p_account,p_revision,p_page);
  if exists(select 1 from public.icash_discovery_configs where account_id=p_account and revision<>p_revision) then return 'inventory_market_changed';end if;
  return 'inventory_waiting';
 end if;
 return 'ready';
end $$;

-- Repeat the exclusion under the existing global financial lock. A second account
-- cannot purchase an identical page while the first provider outcome is unknown.
do $patch$
declare d text;needle text:='if not public.icash_reserve_and_claim_property_discovery';
begin
 d:=pg_get_functiondef('public.icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Filtered admission boundary changed';end if;
 d:=replace(d,needle,$guard$if public.icash_known_assigned_discovery_page(p_zip,p_plan->>'strategy',(p_plan->>'providerPage')::integer,p_per_page) is not null
 or exists(select 1 from public.icash_discovery_filter_pages fp join public.icash_operation_spend os using(operation_key,account_id)
 join public.icash_discovery_configs dc on dc.account_id=fp.account_id where fp.zip=p_zip and fp.plan->>'strategy'=p_plan->>'strategy'
 and fp.plan->>'providerPage'=p_plan->>'providerPage' and dc.per_page=p_per_page and fp.state='claimed' and os.state not in ('settled','cancelled')) then return false;end if;
 if not public.icash_reserve_and_claim_property_discovery$guard$);
 execute d;
end $patch$;

-- Free, bounded ZIP metadata pagination across the currently approved states.
create table public.icash_inventory_geography_sources(
 state_code text primary key,next_page integer not null default 1 check(next_page>0),
 next_scan_at timestamptz not null default now(),claim_token uuid,claim_until timestamptz,
 checked_at timestamptz,last_error text
);
insert into public.icash_inventory_geography_sources(state_code) select distinct state from public.icash_market_shortlist where public.icash_research_state_allowed(state);
alter table public.icash_inventory_geography_sources enable row level security;
revoke all on public.icash_inventory_geography_sources from public,anon,authenticated;
grant select,insert,update on public.icash_inventory_geography_sources to service_role;
create function public.icash_claim_inventory_geographies() returns jsonb language plpgsql set search_path='' as $$
declare s public.icash_inventory_geography_sources;t uuid;
begin
 select * into s from public.icash_inventory_geography_sources where next_scan_at<=now() and (claim_until is null or claim_until<now()) and public.icash_research_state_allowed(state_code) order by next_scan_at,state_code for update skip locked limit 1;
 if not found then return null;end if;
 t:=gen_random_uuid();update public.icash_inventory_geography_sources set claim_token=t,claim_until=now()+interval '2 minutes',next_scan_at=now()+interval '15 minutes' where state_code=s.state_code;
 return jsonb_build_object('state',s.state_code,'page',s.next_page,'token',t);
end $$;
create function public.icash_save_inventory_geographies(p_state text,p_page integer,p_token uuid,p_result jsonb) returns integer language plpgsql set search_path='' as $$
declare s public.icash_inventory_geography_sources;loc jsonb;total_pages integer;n integer:=0;
begin
 select * into s from public.icash_inventory_geography_sources where state_code=p_state for update;
 if not found or s.claim_token is distinct from p_token or s.claim_until<=now() or s.next_page<>p_page then return 0;end if;
 if p_result is null then update public.icash_inventory_geography_sources set claim_token=null,claim_until=null,last_error='metadata_unavailable' where state_code=p_state;return 0;end if;
 if jsonb_typeof(p_result->'data') is distinct from 'array' or jsonb_array_length(p_result->'data')>100
 or (p_result->'pagination'->>'page')::integer is distinct from p_page then raise exception 'Invalid geography receipt';end if;
 total_pages:=(p_result->'pagination'->>'total_pages')::integer;
 if total_pages is null or total_pages<0 or total_pages>1000 then raise exception 'Invalid geography pagination';end if;
 for loc in select value from jsonb_array_elements(p_result->'data') loop
  if loc->>'type' is distinct from 'zip_code' or coalesce(loc->>'code','') !~ '^[0-9]{5}$' or loc->>'state' is distinct from p_state
  or loc->>'location_id' is distinct from 'loc_zip_code_'||(loc->>'code') or jsonb_typeof(loc->'property_count') is distinct from 'number'
  or (loc->>'property_count')::numeric<0 or (loc->>'property_count')::numeric<>trunc((loc->>'property_count')::numeric)
  or (loc->>'property_count')::numeric>9007199254740991 or jsonb_typeof(loc->'name') is distinct from 'string' or length(coalesce(loc->>'name','')) not between 1 and 200 then raise exception 'Invalid ZIP metadata';end if;
  if (loc->>'property_count')::bigint=0 then continue;end if;
  insert into public.icash_property_zip_geographies(zip,state_code,name,property_count,source_ref,checked_at,expires_at)
  values(loc->>'code',p_state,loc->>'name',(loc->>'property_count')::bigint,'https://api.v2.dealmachine.com/v1/locations/'||(loc->>'location_id'),now(),now()+interval '30 days')
  on conflict(zip) do update set state_code=excluded.state_code,name=excluded.name,property_count=excluded.property_count,source_ref=excluded.source_ref,checked_at=excluded.checked_at,expires_at=excluded.expires_at;
  n:=n+1;
 end loop;
 update public.icash_inventory_geography_sources set next_page=case when p_page<total_pages then p_page+1 else 1 end,
 next_scan_at=now()+case when p_page<total_pages then interval '1 minute' else interval '7 days' end,
 claim_token=null,claim_until=null,checked_at=now(),last_error=null where state_code=p_state;
 return n;
end $$;

revoke all on function public.icash_record_discovery_inventory(),public.icash_discovery_no_new_inventory(uuid,text),public.icash_credit_duplicate_discovery(uuid,text),public.icash_customer_discovery_charge(uuid,text,bigint),public.icash_inventory_scope_allowed(uuid,text),public.icash_expand_inventory_markets(uuid),public.icash_known_assigned_discovery_page(text,text,integer,integer),public.icash_prepare_discovery_inventory(uuid,uuid,integer),public.icash_claim_inventory_geographies(),public.icash_save_inventory_geographies(text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_record_discovery_inventory(),public.icash_discovery_no_new_inventory(uuid,text),public.icash_credit_duplicate_discovery(uuid,text),public.icash_customer_discovery_charge(uuid,text,bigint),public.icash_inventory_scope_allowed(uuid,text),public.icash_expand_inventory_markets(uuid),public.icash_known_assigned_discovery_page(text,text,integer,integer),public.icash_prepare_discovery_inventory(uuid,uuid,integer),public.icash_claim_inventory_geographies(),public.icash_save_inventory_geographies(text,integer,uuid,jsonb) to service_role;
commit;
