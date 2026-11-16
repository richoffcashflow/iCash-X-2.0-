-- Source-bound inactive discovery opener renewal.
-- The migration runner owns the transaction and schema-history receipt.
-- Source: config/discovery-opener-refresh.sql
-- Inactive, operator-reviewed renewal of an original never-dispatched discovery opener.
-- No scheduler registration, transport, ticket creation, owner replacement or timestamp extension.
set local lock_timeout='2s';
set local statement_timeout='30s';
create schema icash_discovery_refresh_private;
revoke all on schema icash_discovery_refresh_private from public,anon,authenticated,service_role;
create table icash_discovery_refresh_private.policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text,review_reference text,
 check(not enabled or coalesce(release_sha ~ '^[a-f0-9]{40}$' and length(trim(review_reference))>=12,false))
);
insert into icash_discovery_refresh_private.policy(id) values(1);
create table icash_discovery_refresh_private.renewals(
 id uuid primary key default gen_random_uuid(),message_id uuid not null unique references public.icash_text_messages(id),
 account_id uuid not null references public.icash_accounts(id),thread_id uuid not null references public.icash_text_threads(id),
 screening_id uuid not null references public.icash_screening_jobs(id),original_contact_id uuid not null references public.icash_operational_contacts(id),
 original_snapshot jsonb not null,review_reference text not null check(length(trim(review_reference))>=12),
 created_at timestamptz not null default clock_timestamp(),
 state text not null default 'prepared' check(state in('prepared','researching','ready','review','applied','held')),
 new_snapshot jsonb,new_result jsonb,successor_contact_id uuid references public.icash_operational_contacts(id),
 receipt_id uuid references public.icash_dnc_verification_receipts(id),applied_at timestamptz
);
create table icash_discovery_refresh_private.requests(
 id uuid primary key default gen_random_uuid(),renewal_id uuid not null references icash_discovery_refresh_private.renewals(id),
 kind text not null check(kind in('property','dnc')),operation_key text not null unique references public.icash_operation_spend(operation_key),
 rate_id uuid not null references public.icash_operation_rates(id),unit_cost_micros bigint not null check(unit_cost_micros>0),
 quota_request_id uuid not null unique,requested_at timestamptz not null,request jsonb not null,
 http_status integer,response jsonb,response_at timestamptz,settled boolean not null default false,
 unique(renewal_id,kind),check((response_at is null)=(http_status is null)),check(http_status between 100 and 599)
);
create function icash_discovery_refresh_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Original renewal evidence is immutable';end if;
 if tg_table_name='requests' then
  if to_jsonb(new)-array['http_status','response','response_at','settled'] is distinct from to_jsonb(old)-array['http_status','response','response_at','settled']
   or old.response_at is not null and row(new.http_status,new.response,new.response_at) is distinct from row(old.http_status,old.response,old.response_at)
   or old.settled and not new.settled then raise exception 'Original renewal receipt is immutable';end if;
 else
  if to_jsonb(new)-array['state','new_snapshot','new_result','successor_contact_id','receipt_id','applied_at'] is distinct from to_jsonb(old)-array['state','new_snapshot','new_result','successor_contact_id','receipt_id','applied_at']
   or old.new_snapshot is not null and row(new.new_snapshot,new.new_result) is distinct from row(old.new_snapshot,old.new_result)
   or old.receipt_id is not null and row(new.receipt_id,new.successor_contact_id) is distinct from row(old.receipt_id,old.successor_contact_id)
   or old.applied_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Original renewal binding is immutable';end if;
 end if;
 return new;
end $$;
create trigger renewal_immutable before update or delete on icash_discovery_refresh_private.renewals for each row execute function icash_discovery_refresh_private.immutable();
create trigger request_immutable before update or delete on icash_discovery_refresh_private.requests for each row execute function icash_discovery_refresh_private.immutable();
alter table icash_discovery_refresh_private.policy enable row level security;
alter table icash_discovery_refresh_private.renewals enable row level security;
alter table icash_discovery_refresh_private.requests enable row level security;
revoke all on all tables in schema icash_discovery_refresh_private from public,anon,authenticated,service_role;
-- Read-only diagnostics; all mutations are narrow security-definer contracts.
grant usage on schema icash_discovery_refresh_private to service_role;
grant select on all tables in schema icash_discovery_refresh_private to service_role;

create function public.icash_prepare_discovery_opener_refresh(p_message uuid,p_expected_hash text,p_reference text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source jsonb;v_id uuid;t public.icash_text_threads;d public.icash_deal_files;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 if length(trim(p_reference))<12 or p_reference is null then return null;end if;
 source:=icash_discovery_refresh_private.snapshot(p_message);
 if source is null or encode(sha256(convert_to(source::text,'UTF8')),'hex') is distinct from p_expected_hash then return null;end if;
 select th.* into t from public.icash_text_threads th join public.icash_text_messages m on m.thread_id=th.id where m.id=p_message;
 select * into d from public.icash_deal_files where id=t.deal_id;
 insert into icash_discovery_refresh_private.renewals(message_id,account_id,thread_id,screening_id,original_contact_id,original_snapshot,review_reference)
 values(p_message,t.account_id,t.id,d.screening_id,t.operational_contact_id,source,trim(p_reference)) on conflict(message_id) do nothing returning id into v_id;
 if v_id is not null and not icash_discovery_refresh_private.current(v_id) then raise exception 'Renewal source changed';end if;
 return v_id;
end $$;

create function icash_discovery_refresh_private.reserve_request(p_id uuid,p_kind text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n icash_discovery_refresh_private.renewals;c public.icash_discovery_configs;r public.icash_operation_rates;
 b public.icash_operating_budget;u public.icash_data_cost_settings;costs jsonb;part record;price numeric:=0;quote bigint;
 rate uuid;v_version text;op text:='discovery-refresh:'||p_request_id;reserved jsonb;kind text;
begin
 if p_kind is null or p_kind not in('property','dnc') then return null;end if;
 select * into b from public.icash_operating_budget where id=1 and enabled for update;if not found then return null;end if;
 select * into n from icash_discovery_refresh_private.renewals where id=p_id for update;if not found then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=n.account_id for share nowait;
 if not found or not c.enabled or not c.auto_enabled or not c.contacts_enabled or c.data_rights_until<=clock_timestamp() then return null;end if;
 select * into u from public.icash_data_cost_settings where provider='dealmachine' for share;
 if not found or u.credit_micros is distinct from c.property_credit_micros then return null;end if;
 select * into r from public.icash_operation_rates where id=case when p_kind='property' then c.rate_id else c.contact_rate_id end for share;
 if not found or not r.enabled or r.operation<>(case when p_kind='property' then 'property_search' else 'owner_enrichment' end)
  or r.verified_at>clock_timestamp() or r.expires_at<=clock_timestamp()
  or jsonb_typeof(r.costs_micros->'dealmachine') is distinct from 'number'
  or (r.costs_micros->>'dealmachine')::numeric<u.credit_micros then return null;end if;
 kind:=case when p_kind='property' then 'property_search' else 'contact_revalidation' end;
 costs:=jsonb_set(r.costs_micros,'{dealmachine}',to_jsonb(u.credit_micros));
 for part in select key,value from jsonb_each_text(costs) loop
  price:=price+part.value::numeric*case when part.key='dealmachine' then 3 when part.key='elevenlabs' then b.elevenlabs_cost_multiplier else b.standard_cost_multiplier end;
 end loop;
 quote:=greatest(1,ceil(price*(10000+r.buffer_bps)/100000000)::bigint);
 if quote>r.charge_cents or public.icash_prospecting_available(n.account_id)<public.icash_research_admission_quote(n.account_id,kind,quote) then return null;end if;
 v_version:='discovery-renewal-v1-'||p_kind||'-'||md5(r.id::text||':'||u.credit_micros||':'||quote);
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values(kind,v_version,quote,costs,r.buffer_bps,'Bounded original discovery renewal; inherited source rate '||r.id,r.verified_at,r.expires_at,true) on conflict(version) do nothing;
 select id into rate from public.icash_operation_rates where icash_operation_rates.version=v_version and operation=kind and charge_cents=quote and costs_micros=costs
  and buffer_bps=r.buffer_bps and verified_at=r.verified_at and expires_at=r.expires_at and enabled;
 if rate is null then return null;end if;
 reserved:=public.icash_reserve_operation(n.account_id,op,rate,least(c.data_rights_until,r.expires_at),null,false);
 if reserved->>'state' is distinct from 'reserved' then raise exception 'New source renewal reservation required';end if;
 return reserved||jsonb_build_object('rateId',rate,'unitCostMicros',u.credit_micros);
end $$;

create function public.icash_claim_discovery_opener_refresh(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n icash_discovery_refresh_private.renewals;f icash_discovery_refresh_private.requests;s public.icash_screening_jobs;
 c public.icash_operational_contacts;v_kind text;bill jsonb;request uuid:=gen_random_uuid();quota uuid:=gen_random_uuid();body jsonb;stamp timestamptz;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return null;end if;
 perform 1 from icash_discovery_refresh_private.policy where id=1 and enabled for share;if not found then return null;end if;
 select * into n from icash_discovery_refresh_private.renewals where id=p_id for update;
 if not found or n.state not in('prepared','researching') or not icash_discovery_refresh_private.current(n.id) then return null;end if;
 -- Unknown, contradictory or unsettled requests block additional spending in this bounded workflow.
 if exists(select 1 from icash_discovery_refresh_private.requests where not settled) then return null;end if;
 if exists(select 1 from icash_discovery_refresh_private.requests where requested_at>clock_timestamp()-interval '1 minute') then return null;end if;
 v_kind:=case when not exists(select 1 from icash_discovery_refresh_private.requests where renewal_id=n.id and kind='property') then 'property' else 'dnc' end;
 if exists(select 1 from icash_discovery_refresh_private.requests r where r.renewal_id=n.id and r.kind=v_kind)
  or v_kind='dnc' and (n.new_snapshot is null or n.new_result->'financialCheck'->>'status' is distinct from 'eligible') then return null;end if;
 select * into s from public.icash_screening_jobs where id=n.screening_id and account_id=n.account_id for share;
 select * into c from public.icash_operational_contacts where id=n.original_contact_id and account_id=n.account_id for share;
 body:=case when v_kind='property' then jsonb_build_object('data',jsonb_build_array(jsonb_build_object('full_address',s.snapshot#>>'{raw,data,full_address}')),'contact_audience','none','fields','["dm_property_id","full_address","legal_description","address","city","state","zip","estimated_value","estimated_equity_percentage","estimated_equity_amount","total_estimated_loan_balance","has_active_lien","has_hoa_lien","num_total_active_liens","num_total_open_liens","total_open_lien_amount","is_tax_delinquent","is_free_and_clear","estimated_repair_cost","building_condition","living_area_sqft","num_bedrooms","num_bathrooms","year_built","property_type"]'::jsonb) else jsonb_build_object('phones',jsonb_build_array(jsonb_build_object('number',c.phone))) end;
 if v_kind='property' and length(trim(coalesce(body#>>'{data,0,full_address}','')))<8 then return null;end if;
 if not public.icash_dealmachine_capacity_available(1) then return null;end if;
 bill:=icash_discovery_refresh_private.reserve_request(n.id,v_kind,request);if bill is null then return null;end if;
 stamp:=date_trunc('milliseconds',clock_timestamp());
 insert into icash_discovery_refresh_private.requests(id,renewal_id,kind,operation_key,rate_id,unit_cost_micros,quota_request_id,requested_at,request)
 values(request,n.id,v_kind,bill->>'operationKey',(bill->>'rateId')::uuid,(bill->>'unitCostMicros')::bigint,quota,stamp,body) returning * into f;
 if not public.icash_claim_operation(f.operation_key) then raise exception 'Renewal operation admission held';end if;
 if not public.icash_take_dealmachine_request(case when v_kind='property' then 'property_lookup' else 'phone_dnc' end,n.account_id,f.operation_key,quota) then raise exception 'Renewal quota admission held';end if;
 if not icash_discovery_refresh_private.current(n.id) then raise exception 'Renewal source changed';end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key=f.operation_key and o.account_id=n.account_id and o.state='dispatched' and o.permission_until>clock_timestamp()
   and r.enabled and r.verified_at<=clock_timestamp() and r.expires_at>clock_timestamp()) then raise exception 'Renewal rate expired before handoff';end if;
 update icash_discovery_refresh_private.renewals set state='researching' where id=n.id;
 return jsonb_build_object('id',n.id,'requestId',f.id,'quotaRequestId',quota,'kind',v_kind,'request',body,'requestedAt',stamp,
  'assignmentFeeCents',s.snapshot->'assignmentFeeCents','sellerCostReserveCents',s.snapshot->'sellerCostReserveCents');
end $$;

create function public.icash_record_discovery_opener_refresh(p_id uuid,p_request uuid,p_status integer,p_response jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare f icash_discovery_refresh_private.requests;
begin
 select * into f from icash_discovery_refresh_private.requests where id=p_id and quota_request_id=p_request for update;
 if not found or p_status is null or p_status not between 100 and 599 or octet_length(coalesce(p_response,'null'::jsonb)::text)>262144 then return false;end if;
 if f.response_at is not null then return f.http_status=p_status and f.response is not distinct from p_response;end if;
 update icash_discovery_refresh_private.requests set response=p_response,http_status=p_status,response_at=clock_timestamp() where id=f.id;
 return true;
end $$;

create function icash_discovery_refresh_private.settle_request(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare f icash_discovery_refresh_private.requests;n icash_discovery_refresh_private.renewals;o public.icash_operation_spend;
 r public.icash_operation_rates;used integer;phone text;part record;amount numeric;total numeric:=0;price numeric:=0;
 components jsonb:='{}';source text;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into f from icash_discovery_refresh_private.requests where id=p_id for update;if not found then return false;end if;
 select * into n from icash_discovery_refresh_private.renewals where id=f.renewal_id;
 select * into o from public.icash_operation_spend where operation_key=f.operation_key for update;
 if not found or o.account_id<>n.account_id or o.rate_id<>f.rate_id or o.data_unit_cost_micros is distinct from f.unit_cost_micros
  or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null or o.customer_price_micros is not null
  or f.operation_key is distinct from 'discovery-refresh:'||f.id or f.http_status is distinct from 200
  or f.response_at is null or f.response_at<f.requested_at or f.response_at>clock_timestamp() then return false;end if;
 select * into r from public.icash_operation_rates where id=f.rate_id;
 if not found or r.operation<>(case when f.kind='property' then 'property_search' else 'contact_revalidation' end) then return false;end if;
 if f.settled then return o.state='settled';end if;
 if o.state<>'dispatched' then return false;end if;
 if f.kind='dnc' then
  select c.phone into phone from public.icash_operational_contacts c where c.id=n.original_contact_id;
  if not icash_seller_recovery_private.phone_response_valid(f.response,phone) then return false;end if;
 else
  -- Settle a bounded actual property charge even if identity/underwriting later fails.
  if jsonb_typeof(f.response->'data') is distinct from 'array' then return false;end if;
  if jsonb_array_length(f.response->'data')<>1 or f.response#>'{totals,submitted}' is distinct from '1'::jsonb
   or f.response#>'{credits,people}' is distinct from '0'::jsonb
   or jsonb_typeof(f.response#>'{credits,used}') is distinct from 'number'
   or f.response#>>'{credits,used}' not in('0','1')
   or jsonb_typeof(f.response#>'{data,0,matched}') is distinct from 'boolean'
   or jsonb_typeof(f.response#>'{credits,properties}') is distinct from 'number'
   or jsonb_typeof(f.response#>'{credits,deduplicated}') is distinct from 'number'
   or f.response#>>'{credits,properties}' not in('0','1') or f.response#>>'{credits,deduplicated}' not in('0','1')
   or (f.response#>>'{credits,used}')::int+(f.response#>>'{credits,deduplicated}')::int<>(f.response#>>'{credits,properties}')::int
   or (f.response#>>'{credits,properties}')::int<>(case when f.response#>'{data,0,matched}'='true'::jsonb then 1 else 0 end)
   or f.response#>'{totals,matched}' is distinct from to_jsonb(case when f.response#>'{data,0,matched}'='true'::jsonb then 1 else 0 end)
   or f.response#>'{totals,unmatched}' is distinct from to_jsonb(case when f.response#>'{data,0,matched}'='true'::jsonb then 0 else 1 end) then return false;end if;
 end if;
 used:=(f.response#>>'{credits,used}')::integer;
 if used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric
  or not exists(select 1 from icash_research_private.requests q where q.id=f.quota_request_id and q.account_id=n.account_id
   and q.operation_key=f.operation_key and q.admitted and q.kind=case when f.kind='property' then 'property_lookup' else 'phone_dnc' end
   and q.created_at<=f.response_at) then return false;end if;
 source:='dealmachine:discovery-refresh:'||f.id;
 perform public.icash_record_cost_observation('dealmachine',f.operation_key,source,used,'provider_credits');
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  total:=total+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
  components:=components||jsonb_build_object(part.key,jsonb_build_object('amountMicros',amount,'basis','estimated','evidenceRef',
   case when part.key='dealmachine' then 'Observed renewal credits at saved '||o.data_cost_basis||': '||source else 'Inherited allocation: '||r.version end));
 end loop;
 charge:=ceil(price/10000);
 if charge>o.charge_cap_cents or total>o.reserved_micros then return false;end if;
 perform public.icash_settle_complete_costs(f.operation_key,charge,components,'Discovery evidence renewal v1: '||f.operation_key);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=f.operation_key;
 update icash_discovery_refresh_private.requests set settled=true where id=f.id;
 return true;
end $$;

-- Only authenticated workers may submit arithmetic, always against the original
-- immutable HTTP receipt. Freshness is the DB request-start lower bound, not a
-- caller timestamp or an alteration of the old screening's date.
create function public.icash_qualify_discovery_opener_refresh(p_id uuid,p_output jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare f icash_discovery_refresh_private.requests;n icash_discovery_refresh_private.renewals;s public.icash_screening_jobs;
 fresh jsonb;raw jsonb;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into n from icash_discovery_refresh_private.renewals where id=(select renewal_id from icash_discovery_refresh_private.requests where id=p_id) for update;
 select * into f from icash_discovery_refresh_private.requests where id=p_id and kind='property' for share;
 if not found or not f.settled or f.response_at is null or f.http_status<>200 then return false;end if;
 select * into s from public.icash_screening_jobs where id=n.screening_id and account_id=n.account_id for share;
 raw:=jsonb_build_object('data',f.response#>'{data,0}','credits',f.response->'credits');
 if p_output->>'status' is distinct from 'qualified' or p_output->'numbersPassed' is distinct from 'true'::jsonb
  or p_output#>>'{property,id}' is distinct from s.snapshot->>'propertyId'
  or p_output#>'{property,raw}' is distinct from raw or f.response#>'{data,0,matched}' is distinct from 'true'::jsonb
  or coalesce(f.response#>'{data,0,match_warning}','null'::jsonb) not in ('null'::jsonb,'false'::jsonb)
  or f.response#>'{data,0,input}' is distinct from f.request#>'{data,0}'
  or (p_output#>>'{property,fetchedAt}')::timestamptz is distinct from f.requested_at
  or p_output#>'{property,sellerCostReserveCents}' is distinct from s.snapshot->'sellerCostReserveCents'
  or p_output#>>'{result,financialCheck,status}' is distinct from 'eligible'
  or p_output#>>'{result,property,propertyId}' is distinct from s.snapshot->>'propertyId'
  or (p_output#>>'{result,calculatedAt}')::timestamptz is distinct from f.requested_at
  or (p_output->>'creditsUsed')::integer is distinct from (f.response#>>'{credits,used}')::integer
  or f.requested_at<=clock_timestamp()-interval '24 hours' then return false;end if;
 fresh:=s.snapshot||jsonb_build_object('fetchedAt',p_output#>>'{property,fetchedAt}','raw',raw);
 if n.new_snapshot is not null then return n.new_snapshot=fresh and n.new_result=p_output->'result';end if;
 if not icash_discovery_refresh_private.current(n.id) then return false;end if;
 update icash_discovery_refresh_private.renewals set new_snapshot=fresh,new_result=p_output->'result' where id=n.id;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;

create function public.icash_resume_discovery_opener_refresh(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f record;begin
 perform pg_advisory_xact_lock(726341927);
 -- Bounded receipt processing remains legal after Pause/STOP; applying evidence
 -- or acquiring new work remains subject to fresh customer/source controls.
 for f in select id from icash_discovery_refresh_private.requests where renewal_id=p_id and response_at is not null and not settled order by requested_at limit 2 loop
  if not icash_discovery_refresh_private.settle_request(f.id) then return jsonb_build_object('status','cost_review');end if;
 end loop;
 return icash_discovery_refresh_private.process(p_id);
end $$;

create function public.icash_discovery_opener_refresh_receipt(p_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',f.id,'renewalId',n.id,'raw',f.response,'requestedAt',f.requested_at,
  'assignmentFeeCents',s.snapshot->'assignmentFeeCents','sellerCostReserveCents',s.snapshot->'sellerCostReserveCents')
 from icash_discovery_refresh_private.requests f join icash_discovery_refresh_private.renewals n on n.id=f.renewal_id
 join public.icash_screening_jobs s on s.id=n.screening_id and s.account_id=n.account_id
 where n.id=p_id and f.kind='property' and f.settled and f.http_status=200 and n.new_snapshot is null and n.state in('prepared','researching')
$$;
revoke all on all functions in schema icash_discovery_refresh_private from public,anon,authenticated,service_role;
revoke all on function public.icash_prepare_discovery_opener_refresh(uuid,text,text),public.icash_claim_discovery_opener_refresh(uuid),
 public.icash_record_discovery_opener_refresh(uuid,uuid,integer,jsonb),public.icash_qualify_discovery_opener_refresh(uuid,jsonb),
 public.icash_resume_discovery_opener_refresh(uuid),public.icash_discovery_opener_refresh_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_prepare_discovery_opener_refresh(uuid,text,text),public.icash_claim_discovery_opener_refresh(uuid),
 public.icash_record_discovery_opener_refresh(uuid,uuid,integer,jsonb),public.icash_qualify_discovery_opener_refresh(uuid,jsonb),
 public.icash_resume_discovery_opener_refresh(uuid),public.icash_discovery_opener_refresh_receipt(uuid) to service_role;
create function public.icash_discovery_opener_refresh_release(p_release text) returns boolean
language sql security definer set search_path='' as $$
 select coalesce((select enabled and release_sha=p_release from icash_discovery_refresh_private.policy where id=1),false)
$$;
revoke all on function public.icash_discovery_opener_refresh_release(text) from public,anon,authenticated;
grant execute on function public.icash_discovery_opener_refresh_release(text) to service_role;

-- Source: config/discovery-opener-refresh-apply.sql
-- Inactive, separately reviewed DISCOVERY evidence renewal. Never issues a ticket
-- or sends; original messages, purchases and owner provenance remain immutable.
set local lock_timeout='2s';
set local statement_timeout='8s';

create function icash_discovery_refresh_private.snapshot(p_message uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;s public.icash_screening_jobs;
 c public.icash_operational_contacts;d public.icash_deal_files;answer jsonb;
begin
 select * into m from public.icash_text_messages where id=p_message;
 if not found then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=m.account_id;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=t.account_id;
 select * into c from public.icash_operational_contacts where id=t.operational_contact_id and account_id=t.account_id;
 if m.direction is distinct from 'outgoing' or m.state is distinct from 'ready'
  or m.provider_id is not null or m.last_delivery_at is not null or m.request_key is distinct from t.id
  or cardinality(m.asset_ids) is distinct from 0 or t.party is distinct from 'seller'
  or t.paused is distinct from false or t.manual_only is distinct from false or t.ai_mode is distinct from 'auto'
  or t.retired_at is not null or t.seller_intake_id is not null or t.sms_intake_pending is distinct from false
  or d.stage is distinct from 'draft' or coalesce(d.terms->>'practice','false')<>'false'
  or s.completed_at is null or s.completed_at>clock_timestamp()
  or nullif(s.snapshot->>'fetchedAt','') is null or (s.snapshot->>'fetchedAt')::timestamptz>clock_timestamp()
  or (s.completed_at>clock_timestamp()-interval '24 hours' and c.eligibility_until>clock_timestamp())
  or s.state is distinct from 'complete' or s.result#>>'{financialCheck,status}' is distinct from 'eligible'
  or length(coalesce(s.snapshot#>>'{raw,data,full_address}',''))<8
  or jsonb_typeof(s.snapshot->'assignmentFeeCents') is distinct from 'number'
  or jsonb_typeof(s.snapshot->'sellerCostReserveCents') is distinct from 'number'
  or s.snapshot ? 'sellerRequest' or coalesce(s.snapshot->>'practice','false')<>'false'
  or c.id is null or c.screening_id is distinct from s.id or c.channel is distinct from 'sms'
  or c.phone is distinct from t.recipient or c.timezone is distinct from t.timezone or c.revoked_at is not null
  or t.sender is distinct from t.operational_sms_sender
  or icash_seller_recovery_private.original_contact_binding(t.account_id,c.id) is distinct from true
  or public.icash_membership_work_allowed(t.account_id) is distinct from true
  or public.icash_outreach_sms_current(t.account_id) is distinct from true
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and id<>m.id)
  or exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
  or exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id)
  or exists(select 1 from public.icash_handoffs where account_id=t.account_id and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_signing_envelopes where account_id=t.account_id and deal_id=d.id and not test_mode)
  or exists(select 1 from public.icash_call_recordings where account_id=t.account_id and screening_id=s.id)
  or exists(select 1 from public.icash_live_conversations where account_id=t.account_id and screening_id=s.id)
  or exists(select 1 from public.icash_text_threads where account_id=t.account_id and deal_id=d.id and id<>t.id)
  or exists(select 1 from public.icash_voice_jobs v left join public.icash_contact_permissions cp on cp.id=v.permission_id
    left join public.icash_operational_contacts op on op.id=v.operational_contact_id
    where v.account_id=t.account_id and (cp.screening_id=s.id or op.screening_id=s.id))
  or exists(select 1 from public.icash_sms_inbound_invitations where thread_id=t.id or message_id=m.id)
  or (select count(*) from public.icash_automation_tickets where opener_message_id=m.id) not between 1 and 2
  or exists(select 1 from public.icash_automation_tickets where opener_message_id=m.id and
    (state not in ('issued','held') or issue_attempts is null or issue_attempts not between 1 and 2 or (state='issued' and expires_at>clock_timestamp()) or account_id<>t.account_id or kind<>'seller_opener'
     or state='held' and coalesce(outcome,'') not in ('expired','message_held','messaging_configuration_required','business_number_mismatch','business_number_verification_required')))
  or exists(select 1 from public.icash_property_controls where account_id=t.account_id and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=c.contact_key)
  or exists(select 1 from public.icash_contact_permissions where account_id=t.account_id and screening_id=s.id and phone=t.recipient and revoked_at is not null)
  or exists(select 1 from public.icash_billing_reviews where account_id=t.account_id and resolved_at is null)
 then return null;end if;
 select jsonb_build_object('qualityPolicy',(select to_jsonb(p) from icash_research_private.list_quality_settings p where p.id=1),
  'qualityChoices',(select coalesce(jsonb_agg(to_jsonb(choice) order by choice.person_id),'[]') from icash_research_private.owner_sms_choices choice where oc.result->'requestedPersonIds' ? choice.person_id),
  'renewalPolicy',(select to_jsonb(p) from icash_discovery_refresh_private.policy p where p.id=1),'message',to_jsonb(m),'thread',to_jsonb(t),'screening',to_jsonb(s),'deal',to_jsonb(d),
  'contact',to_jsonb(c),'owner',to_jsonb(oc),'receipt',to_jsonb(dr),'source',to_jsonb(src),
  'campaign',(select to_jsonb(campaign) from public.icash_outreach_campaigns campaign where campaign.account_id=t.account_id),
  'account',jsonb_build_object('id',a.id,'owner_user_id',a.owner_user_id,'bot_paused',a.bot_paused),
  'identity',to_jsonb(i),'config',to_jsonb(cfg)-array['next_run_at','next_page','exhausted','inventory_refreshed_at'],'sender',to_jsonb(sender),'route',to_jsonb(route),
  'smsRate',to_jsonb(rate),'assignment',to_jsonb(assignment),
  'tickets',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.icash_automation_tickets x where x.opener_message_id=m.id))
 into answer from public.icash_accounts a
 join public.icash_customer_identities i on i.account_id=a.id and i.principal=c.sending_principal
 join public.icash_discovery_configs cfg on cfg.account_id=a.id and cfg.enabled and cfg.auto_enabled and cfg.contacts_enabled and cfg.data_rights_until>clock_timestamp()
 join public.icash_owner_contacts oc on oc.account_id=a.id and oc.screening_id=s.id and oc.result->>'propertyId'=s.snapshot->>'propertyId'
 join public.icash_operation_spend spent on spent.operation_key=oc.operation_key and spent.account_id=a.id and spent.state='settled'
 join public.icash_dnc_verification_receipts dr on dr.id=c.dnc_receipt_id and dr.clear and dr.revoked_at is null and dr.evidence_kind='national_provider_observation'
 join public.icash_dnc_verification_sources src on src.id=dr.source_id and src.enabled and src.expires_at>clock_timestamp()
 join public.icash_text_senders sender on sender.phone=t.sender and sender.enabled
 join public.icash_sms_routes route on route.sender=t.sender and route.recipient=t.recipient and route.account_id=a.id and not route.needs_review
 join public.icash_operation_rates rate on rate.id=t.sms_rate_id and rate.enabled and rate.verified_at<=clock_timestamp() and rate.expires_at>clock_timestamp()
 join public.icash_seller_opener_assignments assignment on assignment.message_id=m.id and assignment.thread_id=t.id and assignment.account_id=a.id and assignment.body=m.body
  and assignment.learning_context='cash-question-v6'
  and assignment.variant in ('cash_sale_v6','all_cash_v6','cash_offer_v6')
  and m.body=public.icash_seller_cash_question(assignment.variant,public.icash_conversation_street(d.terms->>'address'))
  and assignment.delivered_at is null and assignment.first_reply_at is null and not assignment.opted_out
 where a.id=t.account_id and not a.bot_paused and a.owner_user_id=c.owner_user_id
  and c.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
  and public.icash_operational_source_phone(oc.result,c.phone)
  -- Snapshot inspection never calls the mutating SMS-choice selector. When
  -- quality policy is active require an already saved same-phone choice.
  and (not exists(select 1 from icash_research_private.list_quality_settings where id=1 and enabled)
   or exists(select 1 from icash_research_private.owner_sms_choices choice
    cross join lateral jsonb_array_elements(oc.result->'contacts') person
    where choice.phone=c.phone and choice.person_id=person->>'personId'
     and oc.result->'requestedPersonIds' ? choice.person_id and person->'likelyOwner'='true'::jsonb
     and exists(select 1 from jsonb_array_elements(person->'phones') ph where public.icash_operational_phone(ph->>'number')=c.phone
      and lower(ph->>'type') in ('wireless','mobile') and ph->'doNotCall'='false'::jsonb)))
  and public.icash_sms_intake_rate_current(rate.id)
  and encode(sha256(convert_to(to_jsonb(rate)::text,'UTF8')),'hex')=t.operational_sms_rate_hash
  and exists(select 1 from public.icash_communication_prices where operation='sms_segment' and customer_micros=t.operational_sms_price_micros);
 return answer;
end $$;

create function icash_discovery_refresh_private.current(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_discovery_refresh_private.renewals;phone text;
begin
 if not pg_try_advisory_xact_lock(726341927) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;if not found then return false;end if;
 select * into r from icash_discovery_refresh_private.renewals where id=p_id for update nowait;
 if not found or r.state not in ('prepared','researching','ready','review') then return false;end if;
 perform 1 from icash_discovery_refresh_private.policy where id=1 and enabled for share nowait;if not found then return false;end if;
 phone:=r.original_snapshot#>>'{thread,recipient}';
 if not pg_try_advisory_xact_lock(hashtextextended(phone,74))
  or not pg_try_advisory_xact_lock(hashtextextended(encode(sha256(convert_to(phone,'UTF8')),'hex'),17)) then return false;end if;
 perform 1 from public.icash_accounts where id=r.account_id for update nowait;
 perform 1 from public.icash_text_threads where id=r.thread_id for update nowait;
 perform 1 from public.icash_text_messages where id=r.message_id for update nowait;
 perform 1 from public.icash_screening_jobs where id=r.screening_id for update nowait;
 perform 1 from public.icash_deal_files where id=(r.original_snapshot#>>'{deal,id}')::uuid for update nowait;
 perform 1 from public.icash_sms_routes where sender=r.original_snapshot#>>'{thread,sender}' and recipient=phone for share nowait;
 perform 1 from public.icash_discovery_configs where account_id=r.account_id for share nowait;
 perform 1 from icash_research_private.list_quality_settings where id=1 for share nowait;
 perform 1 from icash_research_private.owner_sms_choices where r.original_snapshot#>'{owner,result,requestedPersonIds}' ? person_id order by person_id for share nowait;
 perform 1 from public.icash_customer_identities where account_id=r.account_id for share nowait;
 perform 1 from public.icash_outreach_campaigns where account_id=r.account_id for share nowait;
 perform 1 from public.icash_text_senders sender where sender.phone=r.original_snapshot#>>'{thread,sender}' for share nowait;
 return coalesce(r.original_snapshot=icash_discovery_refresh_private.snapshot(r.message_id),false);
exception when lock_not_available then return false;
end $$;

create function icash_discovery_refresh_private.contact_valid(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_discovery_refresh_private.renewals;q icash_discovery_refresh_private.requests;
 c public.icash_operational_contacts;old public.icash_operational_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;stamp timestamptz;
begin
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account for share;
 select * into r from icash_discovery_refresh_private.renewals where successor_contact_id=c.id and account_id=p_account for share;
 if not found or r.state not in ('ready','review','applied') then return false;end if;
 perform 1 from icash_discovery_refresh_private.policy where id=1 for share;
 select * into old from public.icash_operational_contacts where id=r.original_contact_id for share;
 select * into q from icash_discovery_refresh_private.requests where renewal_id=r.id and kind='dnc' for share;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id and id=r.receipt_id for share;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id for share;
 if icash_seller_recovery_private.original_contact_binding(p_account,old.id) is distinct from true then return false;end if;
 stamp:=clock_timestamp();
 return coalesce(exists(select 1 from icash_discovery_refresh_private.policy p where p.id=1 and p.enabled and to_jsonb(p)=r.original_snapshot->'renewalPolicy')
  and old.revoked_at is null and c.revoked_at is null and c.channel='sms'
  and row(old.account_id,old.screening_id,old.phone,old.contact_key,old.owner_user_id,old.source_hash,old.sending_principal,old.timezone,old.timezone_basis,old.local_start_hour,old.local_end_hour)
   is not distinct from row(c.account_id,c.screening_id,c.phone,c.contact_key,c.owner_user_id,c.source_hash,c.sending_principal,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour)
  and q.request=jsonb_build_object('phones',jsonb_build_array(jsonb_build_object('number',c.phone)))
  and q.settled and q.http_status between 200 and 299 and q.response_at>=q.requested_at
  and exists(select 1 from public.icash_operation_spend where operation_key=q.operation_key and account_id=p_account and state='settled')
  and icash_seller_recovery_private.phone_response_valid(q.response,c.phone)
  and q.response#>'{data,0,matched}'='true'::jsonb and q.response#>'{data,0,do_not_call}'='false'::jsonb
  and d.evidence_kind='national_phone_observation' and d.clear and d.revoked_at is null
  and d.phone=c.phone and d.contact_key=c.contact_key and d.checked_at=q.requested_at and d.observation_recorded_at=q.response_at
  and d.receipt_hash=encode(sha256(convert_to(q.response::text,'UTF8')),'hex')
  and d.observation_provenance->>'sourceTable'='icash_discovery_refresh_private.renewals'
  and d.observation_provenance->>'refreshId'=r.id::text and d.observation_provenance->>'requestId'=q.id::text
  and d.observation_provenance->>'operationKey'=q.operation_key and d.observation_provenance->>'originalContactId'=old.id::text
  and d.observation_provenance->>'accountId'=p_account::text and d.observation_provenance->>'screeningId'=c.screening_id::text
  and src.enabled and src.expires_at>stamp and src.evidence_kind='national_provider_observation'
  and src.observation_provider='dealmachine' and src.observation_scope='national_only'
  and d.checked_at<=stamp and d.expires_at>stamp and c.eligibility_until=d.expires_at
  and d.expires_at<=least(q.requested_at+interval '24 hours',q.requested_at+make_interval(secs=>src.max_observation_age_seconds),src.expires_at)
  and exists(select 1 from public.icash_dnc_verification_receipts where id=old.dnc_receipt_id and source_id=src.id and clear and revoked_at is null),false);
end $$;

-- Pin the entire installed predecessor chain; leave all old scopes unchanged.
do $pin$declare x record;d text;begin
 for x in select * from (values
 ('public.icash_lock_operational_dnc(uuid,uuid)','994a2fd9bd7dd31c51bcfe4254d58071'),
 ('icash_seller_recovery_private.original_contact_binding(uuid,uuid)','26fff16d3cc4c274e68d60e48b4af0e6'),
 ('public.icash_operational_contact_current(uuid,uuid,text,boolean)','7d47504dc185227f4d508dafcdffc0f1'),
 ('public.icash_dealmachine_observation_immutable()','6e4a740fa7d0b585b973a58919ac37f3')) v(signature,checksum)
 loop if md5(pg_get_functiondef(x.signature::regprocedure))<>x.checksum then raise exception 'Discovery renewal predecessor changed: %',x.signature;end if;end loop;
 select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='public.icash_dnc_verification_receipts'::regclass and conname='icash_dnc_phone_observation_shape';
 if md5(d) is distinct from '36121bde6cfd0ded016c6f8f9c16fd95' then raise exception 'Discovery renewal DNC shape changed';end if;
 -- Only add a private source-table alternative. Existing observation semantics,
 -- immutable trigger and every old provenance validator remain unchanged.
 if (length(d)-length(replace(d,$boundary$(observation_provenance ->> 'sourceTable'::text) = 'icash_seller_recovery_private.contact_refreshes'::text$boundary$,'')))/length($boundary$(observation_provenance ->> 'sourceTable'::text) = 'icash_seller_recovery_private.contact_refreshes'::text$boundary$)<>1 then raise exception 'Discovery renewal DNC source boundary changed';end if;
 d:=replace(d,$boundary$(observation_provenance ->> 'sourceTable'::text) = 'icash_seller_recovery_private.contact_refreshes'::text$boundary$,
  $boundary$(observation_provenance ->> 'sourceTable'::text) = ANY (ARRAY['icash_seller_recovery_private.contact_refreshes'::text,'icash_discovery_refresh_private.renewals'::text])$boundary$);
 alter table public.icash_dnc_verification_receipts drop constraint icash_dnc_phone_observation_shape;
 execute 'alter table public.icash_dnc_verification_receipts add constraint icash_dnc_phone_observation_shape '||d;
end $pin$;
alter function public.icash_lock_operational_dnc(uuid,uuid) rename to icash_lock_operational_dnc_before_discovery_refresh;
create function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.icash_operational_contacts c join public.icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id
  where c.id=p_contact and c.account_id=p_account and d.observation_provenance->>'sourceTable'='icash_discovery_refresh_private.renewals')
 then return icash_discovery_refresh_private.contact_valid(p_account,p_contact);end if;
 return public.icash_lock_operational_dnc_before_discovery_refresh(p_account,p_contact);
end $$;

create function icash_discovery_refresh_private.process(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r icash_discovery_refresh_private.renewals;q icash_discovery_refresh_private.requests;p icash_discovery_refresh_private.requests;
 c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;
 until_at timestamptz;receipt uuid;contact uuid;
begin
 if not icash_discovery_refresh_private.current(p_id) then return '{"status":"current_controls_hold"}';end if;
 select * into r from icash_discovery_refresh_private.renewals where id=p_id for update;
 if r.successor_contact_id is not null then return jsonb_build_object('status',r.state);end if;
 select * into q from icash_discovery_refresh_private.requests where renewal_id=r.id and kind='dnc' for share;
 select * into p from icash_discovery_refresh_private.requests where renewal_id=r.id and kind='property' for share;
 if q.settled is distinct from true or p.settled is distinct from true
  or not exists(select 1 from public.icash_operation_spend where operation_key=p.operation_key and account_id=r.account_id and state='settled')
  or not exists(select 1 from public.icash_operation_spend where operation_key=q.operation_key and account_id=r.account_id and state='settled')
  or r.new_snapshot is null or r.new_result#>>'{financialCheck,status}' is distinct from 'eligible'
  or (r.new_snapshot->>'fetchedAt')::timestamptz is distinct from p.requested_at
  or p.requested_at<=clock_timestamp()-interval '24 hours' or p.requested_at>clock_timestamp()
 then return '{"status":"evidence_required"}';end if;
 select * into c from public.icash_operational_contacts where id=r.original_contact_id for share;
 if icash_seller_recovery_private.phone_response_valid(q.response,c.phone) is distinct from true
  or q.http_status not between 200 and 299 or q.response#>'{data,0,matched}' is distinct from 'true'::jsonb
  or q.response#>'{data,0,do_not_call}' is distinct from 'false'::jsonb then return '{"status":"not_clear"}';end if;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id for share;
 until_at:=least(q.requested_at+interval '24 hours',q.requested_at+make_interval(secs=>src.max_observation_age_seconds),src.expires_at,
  (select data_rights_until from public.icash_discovery_configs where account_id=r.account_id));
 if until_at is null or until_at<=clock_timestamp() then return '{"status":"fresh_response_expired"}';end if;
 insert into public.icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference,evidence_kind,observation_provenance,observation_recorded_at)
 values(src.id,c.phone,c.contact_key,'dealmachine:discovery-renewal:'||r.id,encode(sha256(convert_to(q.response::text,'UTF8')),'hex'),q.requested_at,until_at,true,
 d.contact_timezone,d.timezone_source_reference,'national_phone_observation',jsonb_build_object('provider','dealmachine','scope','national_only',
 'sourceTable','icash_discovery_refresh_private.renewals','refreshId',r.id,'accountId',r.account_id,'screeningId',r.screening_id,
 'originalContactId',c.id,'operationKey',q.operation_key,'requestId',q.id,'freshnessBasis','saved_request_start_lower_bound',
 'providerCheckedAt',null,'registryUpdatedAt',null,'stateClearance','not_established','consentVerification','not_performed','reportedDoNotCall',false),q.response_at) returning id into receipt;
 insert into public.icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
 values(c.account_id,c.screening_id,'sms',c.phone,c.contact_key,c.timezone,c.timezone_basis,c.local_start_hour,c.local_end_hour,c.owner_user_id,c.sending_principal,c.source_hash,receipt,until_at) returning id into contact;
 update icash_discovery_refresh_private.renewals set receipt_id=receipt,successor_contact_id=contact,state='ready' where id=r.id;
 return jsonb_build_object('status','ready_for_review');
end $$;

create table icash_discovery_refresh_private.reviews(
 id uuid primary key default gen_random_uuid(),renewal_id uuid not null unique references icash_discovery_refresh_private.renewals(id),
 snapshot jsonb not null,note text not null check(length(trim(note))>=12),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
create table icash_discovery_refresh_private.applies(
 review_id uuid primary key references icash_discovery_refresh_private.reviews(id),renewal_id uuid not null unique references icash_discovery_refresh_private.renewals(id),
 after_thread jsonb not null,after_screening jsonb not null,applied_at timestamptz not null default clock_timestamp()
);
create function icash_discovery_refresh_private.review_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('original',r.original_snapshot,'newSnapshot',r.new_snapshot,'newResult',r.new_result,'contact',to_jsonb(c),'receipt',to_jsonb(d),
 'requests',(select jsonb_agg(to_jsonb(q) order by q.kind) from icash_discovery_refresh_private.requests q where q.renewal_id=r.id))
 from icash_discovery_refresh_private.renewals r join public.icash_operational_contacts c on c.id=r.successor_contact_id
 join public.icash_dnc_verification_receipts d on d.id=r.receipt_id where r.id=p_id
$$;
create function public.icash_review_discovery_opener_refresh(p_id uuid,p_hash text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s jsonb;answer uuid;begin
 if length(trim(p_note))<12 or p_note is null or not icash_discovery_refresh_private.current(p_id) then return null;end if;
 s:=icash_discovery_refresh_private.review_snapshot(p_id);
 if s is null or p_hash is distinct from encode(sha256(convert_to(s::text,'UTF8')),'hex') then return null;end if;
 insert into icash_discovery_refresh_private.reviews(renewal_id,snapshot,note) values(p_id,s,p_note) on conflict do nothing returning id into answer;
 if answer is not null then update icash_discovery_refresh_private.renewals set state='review' where id=p_id;end if;
 return answer;
end $$;
create function public.icash_apply_discovery_opener_refresh(p_review uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v icash_discovery_refresh_private.reviews;r icash_discovery_refresh_private.renewals;c public.icash_operational_contacts;d public.icash_dnc_verification_receipts;until_at timestamptz;
begin
 select * into v from icash_discovery_refresh_private.reviews where id=p_review;
 if not found or v.expires_at<=clock_timestamp() or not icash_discovery_refresh_private.current(v.renewal_id) then return false;end if;
 select * into r from icash_discovery_refresh_private.renewals where id=v.renewal_id for update;
 if r.state<>'review' or v.snapshot is distinct from icash_discovery_refresh_private.review_snapshot(r.id)
  or exists(select 1 from icash_discovery_refresh_private.applies where renewal_id=r.id)
  or (r.new_snapshot->>'fetchedAt')::timestamptz<=clock_timestamp()-interval '24 hours'
  or (r.new_snapshot->>'fetchedAt')::timestamptz>clock_timestamp()
  or r.new_result#>>'{financialCheck,status}' is distinct from 'eligible' then return false;end if;
 select * into c from public.icash_operational_contacts where id=r.successor_contact_id for share;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id for share;
 if public.icash_operational_contact_current(r.account_id,c.id,'sms',false) is distinct from true then return false;end if;
 select least(c.eligibility_until,rate.expires_at) into until_at from public.icash_operation_rates rate
 where rate.id=(r.original_snapshot#>>'{thread,sms_rate_id}')::uuid for share;
 if until_at is null or until_at<=clock_timestamp() then return false;end if;
 begin
  -- Original screening is retained byte-for-byte in the immutable journal.
  -- Only freshly acquired evidence replaces the working screening; no age edit.
  update public.icash_screening_jobs set snapshot=r.new_snapshot,result=r.new_result,completed_at=(r.new_snapshot->>'fetchedAt')::timestamptz where id=r.screening_id and account_id=r.account_id;
  update public.icash_text_threads set operational_contact_id=c.id,eligibility_until=until_at,dnc_checked_at=d.checked_at,dnc_clear=d.clear where id=r.thread_id and account_id=r.account_id;
  if public.icash_sms_thread_review_current(r.account_id,r.thread_id,false) is distinct from true
   or v.expires_at<=clock_timestamp() or until_at<=clock_timestamp() then raise exception 'Discovery renewal final authority changed' using errcode='P7501';end if;
  update icash_discovery_refresh_private.renewals set state='applied',applied_at=clock_timestamp() where id=r.id;
  insert into icash_discovery_refresh_private.applies(review_id,renewal_id,after_thread,after_screening)
   select v.id,r.id,to_jsonb(t),to_jsonb(s) from public.icash_text_threads t,public.icash_screening_jobs s where t.id=r.thread_id and s.id=r.screening_id;
 exception when sqlstate 'P7501' then return false;end;
 return true;
exception when lock_not_available then return false;
end $$;
create function icash_discovery_refresh_private.deny_history_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Discovery renewal review and apply history is immutable';end $$;
create trigger review_immutable before update or delete on icash_discovery_refresh_private.reviews for each row execute function icash_discovery_refresh_private.deny_history_change();
create trigger apply_immutable before update or delete on icash_discovery_refresh_private.applies for each row execute function icash_discovery_refresh_private.deny_history_change();
alter table icash_discovery_refresh_private.reviews enable row level security;
alter table icash_discovery_refresh_private.applies enable row level security;
revoke all on icash_discovery_refresh_private.reviews,icash_discovery_refresh_private.applies from public,anon,authenticated,service_role;
grant select on icash_discovery_refresh_private.reviews,icash_discovery_refresh_private.applies to service_role;
revoke all on all functions in schema icash_discovery_refresh_private from public,anon,authenticated,service_role;
revoke all on function public.icash_lock_operational_dnc_before_discovery_refresh(uuid,uuid),public.icash_lock_operational_dnc(uuid,uuid),public.icash_review_discovery_opener_refresh(uuid,text,text),public.icash_apply_discovery_opener_refresh(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_lock_operational_dnc(uuid,uuid),public.icash_review_discovery_opener_refresh(uuid,text,text),public.icash_apply_discovery_opener_refresh(uuid) to service_role;
