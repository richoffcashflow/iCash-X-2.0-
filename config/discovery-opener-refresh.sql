-- Inactive, operator-reviewed renewal of an original never-dispatched discovery opener.
-- No scheduler registration, transport, ticket creation, owner replacement or timestamp extension.
begin;
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
commit;
