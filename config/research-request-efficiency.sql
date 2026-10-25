-- Provider request efficiency. No historical financial or provider receipt is rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create schema if not exists icash_research_private;
revoke all on schema icash_research_private from public,anon,authenticated;
create table icash_research_private.settings(id integer primary key check(id=1),enabled boolean not null default false,pruned_at timestamptz not null default now());
insert into icash_research_private.settings(id,enabled) values(1,false);
create table icash_research_private.requests(
 id uuid primary key,kind text not null,account_id uuid references public.icash_accounts(id),operation_key text,
 admitted boolean not null,created_at timestamptz not null default now(),finished_at timestamptz,result jsonb,
 check(length(kind)<=40),check(operation_key is null or length(operation_key)<=200)
);
create index research_requests_created on icash_research_private.requests(created_at desc,kind);
create index research_requests_account on icash_research_private.requests(account_id,created_at desc);
alter table icash_research_private.settings enable row level security;
alter table icash_research_private.requests enable row level security;
revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;
create function public.icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 if p_request is null or p_kind not in ('search_estimate','property_search','owner_preview','owner_lookup','exclusion_create','exclusion_sync','geography','buyer_estimate','buyer_search','property_lookup','photo') or length(coalesce(p_operation,''))>200 then return false;end if;
 -- Lock the existing limiter first; its counters, windows and ceilings are unchanged.
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 if exists(select 1 from icash_research_private.requests where id=p_request) then return false;end if;
 allowed:=public.icash_take_dealmachine_request();
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)
 values(p_request,p_kind,p_account,p_operation,allowed,case when allowed then null else '{"outcome":"quota_wait"}'::jsonb end);
 return allowed;
end $$;
create function public.icash_finish_dealmachine_request(p_request uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare k text;v jsonb;clean jsonb;
begin
 if coalesce(p_result->>'outcome','') not in ('response','http_error','unknown') or jsonb_typeof(p_result) is distinct from 'object' then return false;end if;
 clean:=jsonb_build_object('outcome',p_result->>'outcome');
 foreach k in array array['httpStatus','returned','creditsUsed','minuteRemaining','dayRemaining','retryAfter'] loop
  v:=p_result->k;
  if v is not null and v<>'null'::jsonb then
   if jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]{1,10}$' then return false;end if;
   clean:=clean||jsonb_build_object(k,v);
  end if;
 end loop;
 update icash_research_private.requests set finished_at=now(),result=clean where id=p_request and admitted and finished_at is null;
 return found;
end $$;
revoke all on function public.icash_take_dealmachine_request(text,uuid,text,uuid),public.icash_finish_dealmachine_request(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_take_dealmachine_request(text,uuid,text,uuid),public.icash_finish_dealmachine_request(uuid,jsonb) to service_role;
create table icash_research_private.exclusions(
 id integer primary key check(id=1),name text not null,list_id text,state text not null default 'new',
 token uuid,lease_until timestamptz,next_at timestamptz not null default now(),batch text[] not null default '{}',last_synced_at timestamptz
);
insert into icash_research_private.exclusions(id,name) values(1,'research-exclusions-'||gen_random_uuid());
create table icash_research_private.exclusion_items(property_id text primary key references public.icash_outbound_property_owners(property_id),synced_at timestamptz);
create index research_exclusions_pending on icash_research_private.exclusion_items(property_id) where synced_at is null;
insert into icash_research_private.exclusion_items(property_id) select property_id from public.icash_outbound_property_owners;
create function icash_research_private.queue_exclusion() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into icash_research_private.exclusion_items(property_id) values(new.property_id) on conflict do nothing;return new;end $$;
create trigger research_exclude_assigned after insert on public.icash_outbound_property_owners for each row execute function icash_research_private.queue_exclusion();
create function public.icash_claim_research_exclusions() returns jsonb language plpgsql security definer set search_path='' as $$
declare s icash_research_private.exclusions;ids text[];t uuid:=gen_random_uuid();action text;
begin
 if not exists(select 1 from icash_research_private.settings where id=1 and enabled) or not public.icash_dealmachine_capacity_available(1) then return null;end if;
 if exists(select 1 from icash_research_private.settings where id=1 and pruned_at<now()-interval '1 day') then
  perform public.icash_prune_research_requests();update icash_research_private.settings set pruned_at=now() where id=1;
 end if;
 select * into s from icash_research_private.exclusions where id=1 for update skip locked;
 if not found or s.next_at>now() or s.lease_until>now() then return null;end if;
 if s.list_id is null then action:=case when s.state='new' then 'create' else 'recover' end;ids:='{}';
 else select coalesce(array_agg(property_id),'{}') into ids from (select property_id from icash_research_private.exclusion_items where synced_at is null order by property_id limit 1000) x;
  if cardinality(ids)=0 then return null;end if;action:='sync';
 end if;
 update icash_research_private.exclusions set token=t,lease_until=now()+interval '1 minute',next_at=now()+interval '10 seconds',batch=ids,state=case when action='create' then 'creating' else state end where id=1;
 return jsonb_build_object('action',action,'token',t,'name',s.name,'listId',s.list_id,'ids',ids);
end $$;
create function public.icash_finish_research_exclusions(p_token uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare s icash_research_private.exclusions;
begin
 select * into s from icash_research_private.exclusions where id=1 for update;
 if s.token is distinct from p_token or s.lease_until<=now() then return false;end if;
 if p_result->'ok' is distinct from 'true'::jsonb then
  update icash_research_private.exclusions set state=case when list_id is null and state='creating' and p_result->'unstarted'='true'::jsonb then 'new' when list_id is null then 'unknown' else state end,token=null,lease_until=null,next_at=now()+interval '5 minutes' where id=1;return false;
 end if;
 if coalesce(p_result->>'listId','') !~ '^[A-Za-z0-9_-]{1,100}$' then return false;end if;
 if s.list_id is null then
  if p_result->>'name' is distinct from s.name then return false;end if;
  update icash_research_private.exclusions set list_id=p_result->>'listId',state='ready' where id=1;
 else
  if s.list_id is distinct from p_result->>'listId' or to_jsonb(s.batch) is distinct from p_result->'ids' then return false;end if;
  update icash_research_private.exclusion_items set synced_at=now() where property_id=any(s.batch) and synced_at is null;
 end if;
 update icash_research_private.exclusions set token=null,lease_until=null,next_at=now()+interval '10 seconds',batch='{}',last_synced_at=now() where id=1;
 return true;
end $$;
alter table icash_research_private.exclusions enable row level security;
alter table icash_research_private.exclusion_items enable row level security;
revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_research_exclusions(),public.icash_finish_research_exclusions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_research_exclusions(),public.icash_finish_research_exclusions(uuid,jsonb) to service_role;
-- Version new quotes instead of changing historic rates or in-flight reservations.
alter table public.icash_discovery_configs add column research_version integer not null default 0 check(research_version in (0,1));
alter table public.icash_discovery_configs add column research_list_id text;
alter table public.icash_discovery_configs drop constraint icash_discovery_configs_per_page_check;
alter table public.icash_discovery_configs add constraint icash_discovery_configs_per_page_check check(per_page between 1 and case when research_version=1 then 25 else 10 end);
alter table public.icash_discovery_inventory_receipts drop constraint icash_discovery_inventory_receipts_per_page_check;
alter table public.icash_discovery_inventory_receipts add constraint icash_discovery_inventory_receipts_per_page_check check(per_page between 1 and 25);
alter table public.icash_discovery_inventory_receipts add column query_policy jsonb;
create table icash_research_private.rate_versions(base_rate uuid not null references public.icash_operation_rates(id),unit_micros bigint not null,batch_rate uuid not null references public.icash_operation_rates(id),primary key(base_rate,unit_micros));
create table icash_research_private.account_rates(account_id uuid primary key references public.icash_accounts(id),base_rate uuid not null references public.icash_operation_rates(id));
create table icash_research_private.query_claims(operation_key text primary key references public.icash_operation_spend(operation_key),account_id uuid not null references public.icash_accounts(id),policy jsonb not null);
create function public.icash_prepare_research_efficiency(p_account uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;r public.icash_operation_rates;base uuid;chosen uuid;large uuid;size integer:=5;list text;cap bigint;quote bigint;
begin
 if not exists(select 1 from icash_research_private.settings where id=1 and enabled) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.enabled or not c.auto_enabled or c.data_rights_until<=now() then return false;end if;
 -- Never rotate away from an unknown or reserved purchase, including old revisions.
 if exists(select 1 from public.icash_operation_spend where account_id=p_account and operation_key like 'discovery:%' and state in ('reserved','dispatched')) then return false;end if;
 select base_rate into base from icash_research_private.account_rates where account_id=p_account;
 if base is null then base:=c.rate_id;insert into icash_research_private.account_rates values(p_account,base);end if;
 select * into r from public.icash_operation_rates where id=base;
 if not found or not r.enabled or r.expires_at<=now() or r.operation<>'property_search' then return false;end if;
 -- A deliberate external rate change becomes the new baseline; never restore a stale rate.
 if c.rate_id<>base and not exists(select 1 from icash_research_private.rate_versions where base_rate=base and batch_rate=c.rate_id) then
  update icash_research_private.account_rates set base_rate=c.rate_id where account_id=p_account;return false;
 end if;
 select batch_rate into large from icash_research_private.rate_versions where base_rate=base and unit_micros=c.property_credit_micros;
 if large is null then
  large:=gen_random_uuid();
  cap:=greatest((r.costs_micros->>'dealmachine')::bigint,c.property_credit_micros*25);
  quote:=r.charge_cents+ceil((cap-(r.costs_micros->>'dealmachine')::bigint)::numeric*3*(10000+r.buffer_bps)/100000000)::bigint;
  insert into public.icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds,flat_customer_price_cents)
  values(large,r.operation,'research25-'||large,quote,jsonb_set(r.costs_micros,'{dealmachine}',to_jsonb(cap)),r.buffer_bps,'research-efficiency-v1:base:'||base,r.verified_at,r.expires_at,r.enabled,r.voice_max_duration_seconds,r.flat_customer_price_cents);
  insert into icash_research_private.rate_versions values(base,c.property_credit_micros,large);
 end if;
 chosen:=base;
 select charge_cents into quote from public.icash_operation_rates where id=large and enabled and expires_at>now();
 if quote is not null and c.max_open_prospects>=20
  and public.icash_prospecting_available(p_account)>=public.icash_research_admission_quote(p_account,'property_search',quote)
  and exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents-reserved_cents>=public.icash_research_admission_quote(p_account,'property_search',quote)) then chosen:=large;size:=25;end if;
 select list_id into list from icash_research_private.exclusions where id=1 and state='ready'
  and not exists(select 1 from icash_research_private.exclusion_items where synced_at is null);
 -- An active exclusion list stays attached while its next free sync is pending.
 list:=coalesce(list,c.research_list_id);
 if row(c.research_version,c.rate_id,c.per_page,c.research_list_id) is distinct from row(1,chosen,size,list) then
  update public.icash_discovery_configs set research_version=1,rate_id=chosen,per_page=size,research_list_id=list,
   max_open_prospects=case when max_open_prospects=20 then 25 else max_open_prospects end,revision=gen_random_uuid(),next_page=1,exhausted=false where account_id=p_account;
 end if;
 return true;
end $$;
-- Admission binds the exact server-selected query policy to its original paid claim.
create function public.icash_reserve_research_discovery(p_account uuid,p_scope jsonb,p_plan jsonb,p_policy jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;ok boolean;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if c.research_version is distinct from 1 or p_policy is distinct from jsonb_build_object('version','research-efficiency-v1','exclusionListId',c.research_list_id) then return false;end if;
 if c.research_list_id is not null and exists(select 1 from icash_research_private.exclusion_items where synced_at is null) then return false;end if;
 if p_plan is not null then
  ok:=public.icash_reserve_and_claim_filtered_discovery(p_account,p_scope->>'p_zip',(p_scope->>'p_revision')::uuid,(p_scope->>'p_page')::integer,(p_scope->>'p_per_page')::integer,(p_scope->>'p_rate')::uuid,(p_scope->>'p_unit')::bigint,(p_scope->>'p_permission_until')::timestamptz,(p_scope->>'p_setup_revision')::integer,p_scope->>'p_market_mode',p_scope->>'p_market',p_plan);
 else
  ok:=public.icash_reserve_and_claim_property_discovery(p_account,p_scope->>'p_zip',(p_scope->>'p_revision')::uuid,(p_scope->>'p_page')::integer,(p_scope->>'p_per_page')::integer,(p_scope->>'p_rate')::uuid,(p_scope->>'p_unit')::bigint,(p_scope->>'p_permission_until')::timestamptz,(p_scope->>'p_setup_revision')::integer,p_scope->>'p_market_mode',p_scope->>'p_market');
 end if;
 if not ok then return false;end if;
 op:='discovery:'||p_account||':'||(p_scope->>'p_revision')||':'||(p_scope->>'p_page');
 insert into icash_research_private.query_claims values(op,p_account,p_policy);return true;
end $$;
create function public.icash_save_research_discovery(p_account uuid,p_operation text,p_revision uuid,p_page integer,p_result jsonb) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from icash_research_private.query_claims where operation_key=p_operation and account_id=p_account and policy=p_result->'queryPolicy') then raise exception 'Research query receipt mismatch';end if;
 if p_result ? 'filterPlan' then return public.icash_save_filtered_discovery(p_account,p_operation,p_revision,p_page,p_result);end if;
 return public.icash_save_discovery(p_account,p_operation,p_revision,p_page,p_result);
end $$;
alter table icash_research_private.rate_versions enable row level security;
alter table icash_research_private.account_rates enable row level security;
alter table icash_research_private.query_claims enable row level security;
revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;
revoke all on function public.icash_prepare_research_efficiency(uuid),public.icash_reserve_research_discovery(uuid,jsonb,jsonb,jsonb),public.icash_save_research_discovery(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.icash_prepare_research_efficiency(uuid),public.icash_reserve_research_discovery(uuid,jsonb,jsonb,jsonb),public.icash_save_research_discovery(uuid,text,uuid,integer,jsonb) to service_role;
-- Guarded edits preserve every unrelated production admission rule.
do $$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text)'::regprocedure);
 needle:='p_per_page not between 1 and 10';replacement:='p_per_page not between 1 and (case when c.research_version=1 then 25 else 10 end)';
 if strpos(d,needle)=0 then raise exception 'Discovery page guard changed';end if;execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure);
 needle:='perform public.icash_discovery_filter_state_v2(p_account,p_revision,p_page);';
 if strpos(d,needle)=0 then raise exception 'Inventory cache guard changed';end if;
 execute replace(d,needle,needle||E'\n if c.research_version=1 then return ''ready'';end if;');
 d:=pg_get_functiondef('public.icash_known_assigned_discovery_page(text,text,integer,integer)'::regprocedure);
 needle:='where r.zip=p_zip';if strpos(d,needle)=0 then raise exception 'Assigned-page cache changed';end if;
 execute replace(d,needle,'where r.query_policy is null and r.zip=p_zip');
 d:=pg_get_functiondef('public.icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb)'::regprocedure);
 needle:='if public.icash_known_assigned_discovery_page(p_zip,p_plan->>''strategy'',(p_plan->>''providerPage'')::integer,p_per_page) is not null';
 if strpos(d,needle)=0 then raise exception 'Filtered cache guard changed';end if;
 execute replace(d,needle,'if ((select research_version=0 from public.icash_discovery_configs where account_id=p_account) and public.icash_known_assigned_discovery_page(p_zip,p_plan->>''strategy'',(p_plan->>''providerPage'')::integer,p_per_page) is not null)');
 d:=pg_get_functiondef('public.icash_save_filtered_discovery(uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:='set next_page=next_page+1,pages=pages+1';if strpos(d,needle)=0 then raise exception 'Filter cursor changed';end if;
 execute replace(d,needle,'set next_page=case when p_result->''queryPolicy''->>''exclusionListId'' is not null then 1 else next_page+1 end,pages=pages+1');
 d:=pg_get_functiondef('public.icash_record_discovery_inventory()'::regprocedure);
 needle:='has_next_page,created_at)';if strpos(d,needle)=0 then raise exception 'Inventory receipt changed';end if;
 d:=replace(d,needle,'has_next_page,created_at,query_policy)');
 needle:='coalesce((plan->>''providerPage'')::integer,c.next_page)';if strpos(d,needle)=0 then raise exception 'Provider page receipt changed';end if;
 d:=replace(d,needle,'case when new.result->''queryPolicy''->>''exclusionListId'' is not null then 1 else coalesce((plan->>''providerPage'')::integer,c.next_page) end');
 needle:='new.created_at);';if strpos(d,needle)=0 then raise exception 'Inventory timestamp changed';end if;
 execute replace(d,needle,'new.created_at,new.result->''queryPolicy'');');
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:='perform public.icash_refresh_opportunity_outcomes(c.account_id);';if strpos(d,needle)=0 then raise exception 'Acquisition scheduler changed';end if;
 execute replace(d,needle,'perform public.icash_prepare_research_efficiency(c.account_id);'||E'\n select * into c from public.icash_discovery_configs where account_id=c.account_id;'||E'\n '||needle);
end $$;
create table icash_research_private.owner_batches(id uuid primary key,account_id uuid not null references public.icash_accounts(id),primary_screening uuid not null,created_at timestamptz not null default now(),state text not null default 'claimed',items jsonb not null,preview_receipt jsonb not null,paid_receipt jsonb,results jsonb);
create table icash_research_private.owner_batch_items(screening_id uuid primary key references public.icash_screening_jobs(id),batch_id uuid not null references icash_research_private.owner_batches(id),operation_key text unique not null references public.icash_operation_spend(operation_key));
create index owner_batches_account on icash_research_private.owner_batches(account_id,created_at desc);
create function public.icash_owner_batch_candidates(p_account uuid,p_screening uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.icash_discovery_configs;r public.icash_operation_rates;n integer;result jsonb;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if c.research_version is distinct from 1 or not c.enabled or not c.contacts_enabled or c.data_rights_until<=now() or not r.enabled or r.operation<>'owner_enrichment' or r.expires_at<=now() then return '[]';end if;
 n:=least(5,greatest(0,floor((least(public.icash_prospecting_available(p_account),coalesce((select balance_cents-reserved_cents from public.icash_wallets where account_id=p_account),0))-public.icash_prospecting_outreach_floor(p_account))::numeric/greatest(1,r.charge_cents))::integer));
 select coalesce(jsonb_agg(jsonb_build_object('screeningId',id,'snapshot',snapshot) order by (id=p_screening) desc,id),'[]') into result from (
  select s.id,s.snapshot from public.icash_screening_jobs s where s.account_id=p_account and s.state='complete' and s.completed_at between now()-interval '24 hours' and now()
  and s.result->'financialCheck'->>'status'='eligible' and not s.snapshot ? 'sellerRequest' and s.snapshot->>'propertyType'='house'
  and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state')
  and not exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
  and not exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=p_account and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>now()-interval '30 days')
  and not exists(select 1 from public.icash_operation_spend o join public.icash_screening_jobs prior on o.operation_key='owners:'||p_account||':'||prior.id where prior.account_id=p_account and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and o.state in ('reserved','dispatched'))
  and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||p_account||':'||s.id)
  and (s.id=p_screening or not exists(select 1 from public.icash_automation_tickets t where t.screening_id=s.id))
  order by (s.id=p_screening) desc,s.id limit n
 ) q;
 if not exists(select 1 from jsonb_array_elements(result) v where v->>'screeningId'=p_screening::text) then return '[]';end if;return result;
end $$;
create function public.icash_claim_owner_batch(p_account uuid,p_primary uuid,p_batch uuid,p_items jsonb,p_preview jsonb,p_config jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;r public.icash_operation_rates;item jsonb;sid uuid;op text;preview jsonb;person text;
begin
 if p_batch is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 5 or octet_length(p_preview::text)>2097152 then return false;end if;
 if not exists(select 1 from jsonb_array_elements(p_items) v where v->>'screeningId'=p_primary::text)
 or (select count(distinct v->>'screeningId') from jsonb_array_elements(p_items) v)<>jsonb_array_length(p_items) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if c.research_version is distinct from 1 or row(c.contact_rate_id,c.contact_credit_cap,c.property_credit_micros,c.data_rights_until) is distinct from row((p_config->>'rateId')::uuid,(p_config->>'creditCap')::integer,(p_config->>'unitCostMicros')::bigint,(p_config->>'rightsUntil')::timestamptz) then return false;end if;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if exists(select 1 from icash_research_private.owner_batches where id=p_batch) or p_preview->'credits' is distinct from '{"used":0,"people":0,"properties":0,"deduplicated":0}'::jsonb then return false;end if;
 for item in select value from jsonb_array_elements(p_items) loop
  sid:=(item->>'screeningId')::uuid;op:='owners:'||p_account||':'||sid;
  if jsonb_typeof(item->'ids') is distinct from 'array' or jsonb_array_length(item->'ids') not between 1 and c.contact_credit_cap then raise exception 'Owner batch audience invalid';end if;
  if sid<>p_primary and exists(select 1 from public.icash_automation_tickets where screening_id=sid) then raise exception 'Owner batch sibling already ticketed';end if;
  if exists(select 1 from public.icash_operation_spend where operation_key=op) then raise exception 'Owner batch operation already exists';end if;
  if exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=p_account and prior.snapshot->>'propertyId'=item->'snapshot'->>'propertyId' and oc.created_at>now()-interval '30 days') then raise exception 'Owner batch property already enriched';end if;
  select value into strict preview from jsonb_array_elements(p_preview->'data') where value->>'dm_property_id'=item->'snapshot'->>'propertyId' and value->'found'='true'::jsonb;
  for person in select value from jsonb_array_elements_text(item->'ids') loop
   if person !~ '^per_[a-zA-Z0-9]{1,100}$' or not exists(select 1 from jsonb_array_elements(preview->'contacts') p where p->>'dm_person_id'=person and p->'is_likely_renter' is distinct from 'true'::jsonb and (p->'is_likely_owner'='true'::jsonb or (p->>'is_likely_owner' is null and p->>'contact_type'='owner'))) then raise exception 'Owner batch preview mismatch';end if;
  end loop;
  perform public.icash_reserve_operation(p_account,op,c.contact_rate_id,c.data_rights_until,null,false);
  if not public.icash_claim_owner_enrichment(p_account,sid,op,item->'snapshot',c.contact_rate_id,c.contact_credit_cap,c.property_credit_micros,(r.costs_micros->>'dealmachine')::bigint,c.data_rights_until) then raise exception 'Owner batch admission held';end if;
 end loop;
 insert into icash_research_private.owner_batches(id,account_id,primary_screening,items,preview_receipt) values(p_batch,p_account,p_primary,p_items,p_preview);
 insert into icash_research_private.owner_batch_items select (v->>'screeningId')::uuid,p_batch,'owners:'||p_account||':'||(v->>'screeningId') from jsonb_array_elements(p_items) v;
 return true;
end $$;
create function public.icash_record_owner_batch_receipt(p_account uuid,p_batch uuid,p_receipt jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare b icash_research_private.owner_batches;
begin
 select * into b from icash_research_private.owner_batches where id=p_batch and account_id=p_account for update;
 if not found or p_receipt is null or octet_length(p_receipt::text)>2097152 then return false;end if;
 if b.paid_receipt is not null then return b.paid_receipt=p_receipt;end if;
 update icash_research_private.owner_batches set paid_receipt=p_receipt where id=p_batch;return true;
end $$;
create function public.icash_save_owner_batch(p_account uuid,p_batch uuid,p_results jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare b icash_research_private.owner_batches;item jsonb;r jsonb;sid uuid;op text;field text;sum_used bigint:=0;sum_people bigint:=0;sum_dedup bigint:=0;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into b from icash_research_private.owner_batches where id=p_batch and account_id=p_account for update;
 if not found or b.paid_receipt is null or jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>jsonb_array_length(b.items) then return false;end if;
 if b.state='complete' then return b.results=p_results;end if;
 for item in select value from jsonb_array_elements(b.items) loop
  sid:=(item->>'screeningId')::uuid;op:='owners:'||p_account||':'||sid;
  select value->'result' into strict r from jsonb_array_elements(p_results) where value->>'screeningId'=sid::text;
  if r->>'propertyId' is distinct from item->'snapshot'->>'propertyId' or r->'requestedPersonIds' is distinct from item->'ids' or r->'outreachAuthorized' is distinct from 'false'::jsonb
   or r->'allocation'->>'batchId' is distinct from p_batch::text or r->'allocation'->>'method' is distinct from 'unique-person-order-v1'
   or (r->>'creditsUsed')::bigint is distinct from (r->'providerCredits'->>'used')::bigint
   or (r->'providerCredits'->>'properties')::bigint is distinct from 0 then raise exception 'Owner batch result mismatch';end if;
  foreach field in array array['used','people','properties','deduplicated'] loop
   if coalesce(r->'providerCredits'->>field,'') !~ '^[0-9]{1,3}$' then raise exception 'Owner batch credit invalid';end if;
  end loop;
  if (r->'providerCredits'->>'used')::bigint+(r->'providerCredits'->>'deduplicated')::bigint<>(r->'providerCredits'->>'people')::bigint or (r->'providerCredits'->>'people')::bigint>jsonb_array_length(item->'ids') then raise exception 'Owner batch credit mismatch';end if;
  sum_used:=sum_used+(r->'providerCredits'->>'used')::bigint;sum_people:=sum_people+(r->'providerCredits'->>'people')::bigint;sum_dedup:=sum_dedup+(r->'providerCredits'->>'deduplicated')::bigint;
  foreach field in array array['used','people','properties','deduplicated'] loop
   perform public.icash_record_cost_observation('dealmachine',op||case when field='used' then '' else ':'||field end,'dealmachine:owners:'||op||case when field='used' then '' else ':'||field end,(r->'providerCredits'->>field)::numeric,'provider_credits');
  end loop;
  perform public.icash_save_contacts(p_account,sid,op,r);
 end loop;
 if sum_used is distinct from (b.paid_receipt->'credits'->>'used')::bigint or sum_people is distinct from (b.paid_receipt->'credits'->>'people')::bigint or sum_dedup is distinct from (b.paid_receipt->'credits'->>'deduplicated')::bigint or (b.paid_receipt->'credits'->>'properties')::bigint is distinct from 0 then raise exception 'Owner batch allocation does not match original receipt';end if;
 for op in select operation_key from icash_research_private.owner_batch_items where batch_id=p_batch order by operation_key loop perform public.icash_settle_dealmachine_usage(op);end loop;
 update icash_research_private.owner_batches set state='complete',results=p_results where id=p_batch;return true;
end $$;
alter table icash_research_private.owner_batches enable row level security;
alter table icash_research_private.owner_batch_items enable row level security;
revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;
revoke all on function public.icash_owner_batch_candidates(uuid,uuid),public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb),public.icash_record_owner_batch_receipt(uuid,uuid,jsonb),public.icash_save_owner_batch(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_owner_batch_candidates(uuid,uuid),public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb),public.icash_record_owner_batch_receipt(uuid,uuid,jsonb),public.icash_save_owner_batch(uuid,uuid,jsonb) to service_role;
create function public.icash_research_efficiency_summary(p_hours integer default 24) returns jsonb language sql stable security definer set search_path='' as $$
 with request_counts as (
  select kind,count(*) attempts,count(*) filter(where admitted) admitted,
   count(*) filter(where not admitted) quota_wait,count(*) filter(where result->>'outcome'='response') responses,
   count(*) filter(where result->>'outcome'='http_error') http_errors,
   count(*) filter(where admitted and (result is null or result->>'outcome'='unknown')) unknown,
   coalesce(sum((result->>'returned')::bigint),0) returned,coalesce(sum((result->>'creditsUsed')::bigint),0) credits_used
  from icash_research_private.requests where created_at>now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),168))) group by kind
 ), inventory as (
  select count(*) pages,coalesce(sum(returned_properties),0) returned,coalesce(sum(queued_properties),0) queued,coalesce(sum(duplicate_properties),0) duplicates
  from public.icash_discovery_inventory_receipts where created_at>now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),168)))
 ), screening as (
  select count(*) filter(where result->'financialCheck'->>'status'='eligible') eligible,count(*) filter(where result->'financialCheck'->>'status'='hold') held
  from public.icash_screening_jobs where completed_at>now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),168))) and not snapshot ? 'sellerRequest'
 ) select jsonb_build_object('hours',greatest(1,least(coalesce(p_hours,24),168)),'requests',coalesce((select jsonb_agg(to_jsonb(r) order by kind) from request_counts r),'[]'::jsonb),'inventory',(select to_jsonb(i) from inventory i),'screening',(select to_jsonb(s) from screening s),'ownerBatches',(select count(*) from icash_research_private.owner_batches where created_at>now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),168))) and state='complete'),'coverage','property search, owner preview/lookup, exclusion maintenance; other endpoints are not included');
$$;
-- Bounded pruning keeps request diagnostics for 30 days; billing and batch
-- receipts are separate immutable evidence and are never pruned here.
create function public.icash_prune_research_requests() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 delete from icash_research_private.requests where id in (select id from icash_research_private.requests where created_at<now()-interval '30 days' order by created_at limit 10000);
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.icash_research_efficiency_summary(integer),public.icash_prune_research_requests() from public,anon,authenticated;
grant execute on function public.icash_research_efficiency_summary(integer),public.icash_prune_research_requests() to service_role;
commit;
