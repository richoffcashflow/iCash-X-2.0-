-- Exact exhausted-credit evidence blocks new paid requests. Bounded free usage
-- reads can observe replenishment; they do not settle or repeat an original buy.
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_dealmachine_request_budget where id=1 for update;
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $check$
declare r record;p jsonb;
begin
 for r in select * from (values
 ('public.icash_prune_research_requests()','9b8d5452c2db9d51ab67fe587dfbfd35',true),
 ('icash_research_private.capacity_probe_response_fresh(jsonb,timestamptz,timestamptz)','ac0c4bb2bc9dd714249dcfad8b6dd088',false),
 ('public.icash_finish_dealmachine_request(uuid,jsonb)','dee972b5f2f482e8d302187125cfdd20',true),
 ('public.icash_record_owner_export_receipt(uuid,uuid,jsonb)','fe21f05f45821b0d1c38542a3fb79da8',true),
 ('icash_research_private.guard_capacity_precision_followup()','765e0c19c4d74f0239f91734ed7259a5',false),
 ('public.icash_claim_automatic_export_capacity(text)','75cc1b83ba1db8630547395b823758f9',true),
 ('public.icash_claim_export_capacity_probe(uuid,text)','8d8d061ae0c19d92baad2d796d6f2ed0',true),
 ('public.icash_finish_automatic_export_capacity(uuid)','0474f0f037f7aa20104fe4a94c360835',true),
 ('icash_research_private.take_reserved_request(text,uuid,text,uuid)','2182dcab3cb6a780911298ae8fbb8da7',true),
 ('icash_research_private.capacity_source_policy(uuid,text)','f22d91e5c789c1c28a15244f31baf723',false)
 ) x(signature,checksum,security_definer) loop
  if not exists(select 1 from pg_proc f where f.oid=to_regprocedure(r.signature)
   and md5(pg_get_functiondef(f.oid))=r.checksum and f.proowner='postgres'::regrole
   and f.prosecdef=r.security_definer and f.proconfig=array['search_path=""']
   and f.provolatile=case when r.signature='icash_research_private.capacity_source_policy(uuid,text)' then 's'::"char" when r.signature='icash_research_private.capacity_probe_response_fresh(jsonb,timestamptz,timestamptz)' then 'i'::"char" else 'v'::"char" end
   and not has_function_privilege('anon',f.oid,'execute') and not has_function_privilege('authenticated',f.oid,'execute')
   and has_function_privilege('service_role',f.oid,'execute')=(r.signature like 'public.%')) then
   raise exception 'Provider credit prerequisite changed: %',r.signature;
  end if;
 end loop;
 select function_hashes into p from icash_research_private.owner_export_quota_policy where id=1 for update;
 if jsonb_typeof(p) is distinct from 'object' or p->>'icash_research_private.take_reserved_request(text,uuid,text,uuid)' is distinct from '2182dcab3cb6a780911298ae8fbb8da7'
  or p->>'public.icash_prune_research_requests()' is distinct from '9b8d5452c2db9d51ab67fe587dfbfd35'
  or exists(select 1 from jsonb_each_text(p) h where to_regprocedure(h.key) is null or h.value is distinct from md5(pg_get_functiondef(to_regprocedure(h.key)))) then
  raise exception 'Provider credit owner quota manifest changed';
 end if;
end $check$;

create table icash_research_private.dealmachine_credit_state(
 id integer primary key check(id=1),enabled boolean not null default false,release_sha text,activated_at timestamptz,
 blocked boolean not null default false,generation bigint not null default 0,
 latest_refusal_at timestamptz,latest_usage_at timestamptz,latest_usage_generation bigint,available bigint,
 cycle_end timestamptz,next_check_at timestamptz not null default clock_timestamp(),last_claim_at timestamptz,
 function_hashes jsonb not null default '{}'::jsonb
);
insert into icash_research_private.dealmachine_credit_state(id) values(1);
create table icash_research_private.dealmachine_credit_refusals(
 request_id uuid primary key,recorded_at timestamptz not null default clock_timestamp(),receipt jsonb not null,
 request_snapshot jsonb not null,export_request jsonb
);
create table icash_research_private.dealmachine_credit_checks(
 id uuid primary key,request_id uuid not null unique,generation bigint not null,release_sha text not null,
 started_at timestamptz not null,received_at timestamptz,receipt jsonb,result text,
 check((received_at is null and receipt is null and result is null) or (received_at is not null and receipt is not null and result is not null))
);
alter table icash_research_private.dealmachine_credit_state enable row level security;
alter table icash_research_private.dealmachine_credit_refusals enable row level security;
alter table icash_research_private.dealmachine_credit_checks enable row level security;
revoke all on icash_research_private.dealmachine_credit_state,icash_research_private.dealmachine_credit_refusals,icash_research_private.dealmachine_credit_checks from public,anon,authenticated,service_role;

create function icash_research_private.guard_dealmachine_credit_evidence() returns trigger
language plpgsql set search_path='' as $$begin
 if TG_OP='DELETE' then raise exception 'Provider credit evidence is immutable';end if;
 if TG_TABLE_NAME='dealmachine_credit_refusals' or old.receipt is not null
  or (to_jsonb(new)-array['receipt','result','received_at']) is distinct from (to_jsonb(old)-array['receipt','result','received_at'])
  or new.receipt is null or new.result is null or new.received_at is null then raise exception 'Provider credit evidence is immutable';end if;
 return new;
end$$;
create trigger immutable_credit_refusal before update or delete on icash_research_private.dealmachine_credit_refusals for each row execute function icash_research_private.guard_dealmachine_credit_evidence();
create trigger immutable_credit_check before update or delete on icash_research_private.dealmachine_credit_checks for each row execute function icash_research_private.guard_dealmachine_credit_evidence();

create function icash_research_private.credit_count(p jsonb) returns boolean
language sql immutable set search_path='' as $$select coalesce(jsonb_typeof(p)='number' and p::text~'^[0-9]{1,16}$' and p::numeric<=9007199254740991,false)$$;
create function icash_research_private.credit_receipt_envelope(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$begin
 return jsonb_typeof(p)='object' and octet_length(p::text)<=131072 and jsonb_typeof(p->'rawText')='string'
  and octet_length(p->>'rawText')<=65536 and (p->>'rawText')::jsonb=p->'raw' and jsonb_typeof(p->'raw')='object';
exception when others then return false;end$$;
create function icash_research_private.credit_refusal_exact(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb:=p->'raw';d jsonb:=p#>'{raw,error,details}';u jsonb:=p#>'{raw,usage}';k text;cycle timestamptz;
begin
 if icash_research_private.credit_receipt_envelope(p) is distinct from true or p->'httpStatus' is distinct from '402'::jsonb then return false;end if;
 if coalesce(r#>>'{error,request_id}','')!~'^req_[A-Za-z0-9_-]{1,100}$' then return false;end if;
 foreach k in array array['remaining_credits','additional_enrichment_credit_balance','monthly_remaining','additional_remaining','total_enrichment_credit_available'] loop
  if d->k is distinct from '0'::jsonb then return false;end if;
 end loop;
 foreach k in array array['monthly_enrichment_credit_cap','total_enrichment_credit_cap'] loop
  if icash_research_private.credit_count(d->k) is distinct from true then return false;end if;
 end loop;
 if icash_research_private.credit_count(u->'credits_used') is distinct from true or u->'credits_remaining' is distinct from '0'::jsonb
  or jsonb_typeof(d->'billing_cycle_end') is distinct from 'string'
  or coalesce(d->>'billing_cycle_end','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false;end if;
 cycle:=(d->>'billing_cycle_end')::timestamptz;if cycle is null or not isfinite(cycle) then return false;end if;
 if d is distinct from jsonb_build_object('remaining_credits',0,'monthly_enrichment_credit_cap',d->'monthly_enrichment_credit_cap',
  'additional_enrichment_credit_balance',0,'monthly_remaining',0,'additional_remaining',0,'total_enrichment_credit_cap',d->'total_enrichment_credit_cap',
  'total_enrichment_credit_available',0,'billing_cycle_end',d->'billing_cycle_end') then return false;end if;
 return r=jsonb_build_object('error',jsonb_build_object('code','export_limit_exceeded','message','Data credit limit reached for this billing cycle.',
  'request_id',r#>'{error,request_id}','details',d),'usage',(d-'remaining_credits')||jsonb_build_object('credits_used',u->'credits_used','credits_remaining',0));
exception when others then return false;
end$$;

create function public.icash_record_dealmachine_credit_refusal(p_request uuid,p_receipt jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare q icash_research_private.requests;previous icash_research_private.dealmachine_credit_refusals;stamp timestamptz;
begin
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 perform 1 from icash_research_private.dealmachine_credit_state where id=1 for update;
 select * into previous from icash_research_private.dealmachine_credit_refusals where request_id=p_request;
 if found then return case when previous.receipt=p_receipt then 'provider_credit_exhausted' else 'credit_check_held' end;end if;
 select * into q from icash_research_private.requests where id=p_request;
 if icash_research_private.credit_refusal_exact(p_receipt) is distinct from true or q.id is null or q.admitted is distinct from true
  or q.kind is null or q.kind not in ('owner_lookup','property_search','buyer_search','property_lookup') or q.account_id is null or coalesce(length(q.operation_key),0)=0
  or q.result->>'outcome' is distinct from 'http_error' or q.result->'httpStatus' is distinct from '402'::jsonb or q.result?'creditsUsed'
  or q.created_at is null or q.finished_at is null or q.finished_at<q.created_at or q.finished_at>clock_timestamp()
  or (p_receipt#>>'{raw,error,details,billing_cycle_end}')::timestamptz<=q.created_at then return 'credit_check_held';end if;
 insert into icash_research_private.dealmachine_credit_refusals(request_id,receipt,request_snapshot,export_request)
  values(p_request,p_receipt,to_jsonb(q),(select request from icash_research_private.owner_exports where id=q.id and q.kind='owner_lookup' and q.operation_key='owner-batch:'||q.id));
 stamp:=clock_timestamp();
 update icash_research_private.dealmachine_credit_state set blocked=true,generation=generation+1,latest_refusal_at=stamp,available=0,
  cycle_end=(p_receipt#>>'{raw,error,details,billing_cycle_end}')::timestamptz,
  next_check_at=greatest(stamp,coalesce(last_claim_at+interval '15 minutes',stamp)) where id=1;
 return 'provider_credit_exhausted';
exception when invalid_text_representation or datetime_field_overflow then return 'credit_check_held';
end$$;

create function public.icash_dealmachine_credit_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case when not enabled then 'credit_check_not_requested' when blocked then 'provider_credit_exhausted'
  when latest_usage_at is not null then 'provider_credit_available' else 'credit_check_not_requested' end,
  'nextCheckAt',case when enabled and blocked then next_check_at end) from icash_research_private.dealmachine_credit_state where id=1
$$;
create function public.icash_claim_dealmachine_credit_check(p_release text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s icash_research_private.dealmachine_credit_state;c uuid:=gen_random_uuid();r uuid:=gen_random_uuid();stamp timestamptz;
begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return null;end if;
 -- Idle maintenance does not contend with paid/request admission. Evaluate
 -- only the one pending export, never the retained historical export table.
 select * into s from icash_research_private.dealmachine_credit_state where id=1;
 if not found or not s.enabled or s.next_check_at>clock_timestamp() or (not s.blocked and not exists(
  select 1 from icash_research_private.owner_exports e where e.terminal_at is null and e.capacity_review_id is null
   and icash_research_private.credit_export_source(e.id,md5(e.receipt::text)))) then return null;end if;
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update nowait;
 if not found then return null;end if;
 select * into s from icash_research_private.dealmachine_credit_state where id=1 for update nowait;
 stamp:=clock_timestamp();
 if not found or not s.enabled or s.next_check_at>stamp or (not s.blocked and not exists(
  select 1 from icash_research_private.owner_exports e where e.terminal_at is null and e.capacity_review_id is null
   and icash_research_private.credit_export_source(e.id,md5(e.receipt::text)))) then return null;end if;
 -- Every claim, including a local quota denial or lost response, observes the
 -- same bounded cadence. There is never a lease that authorizes repeating GET.
 update icash_research_private.dealmachine_credit_state set last_claim_at=stamp,next_check_at=stamp+interval '15 minutes' where id=1;
 if not public.icash_take_dealmachine_request('owner_preview',null,'provider-credit-check:'||c,r) then return null;end if;
 insert into icash_research_private.dealmachine_credit_checks(id,request_id,generation,release_sha,started_at) values(c,r,s.generation,p_release,stamp);
 return jsonb_build_object('checkId',c,'requestId',r);
exception when lock_not_available then return null;
end$$;
create function public.icash_record_dealmachine_credit_check(p_check uuid,p_receipt jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare c icash_research_private.dealmachine_credit_checks;s icash_research_private.dealmachine_credit_state;q icash_research_private.requests;
 stamp timestamptz;raw jsonb;valid boolean:=false;decision text:='credit_check_held';cycle_start timestamptz;cycle_finish timestamptz;amount bigint;
begin
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 select * into s from icash_research_private.dealmachine_credit_state where id=1 for update;
 select * into c from icash_research_private.dealmachine_credit_checks where id=p_check for update;
 if not found then return 'credit_check_held';end if;
 if c.receipt is not null then return case when c.receipt=p_receipt then c.result else 'credit_check_held' end;end if;
 -- Unbounded input is rejected; every bounded first response is retained even
 -- if the canonical finish acknowledgement or provider schema is missing.
 if p_receipt is null or octet_length(p_receipt::text)>131072 then return 'credit_check_held';end if;
 stamp:=clock_timestamp();raw:=p_receipt->'raw';select * into q from icash_research_private.requests where id=c.request_id;
 begin
  valid:=s.enabled and s.generation=c.generation and stamp-c.started_at between interval '0 seconds' and interval '60 seconds'
   and icash_research_private.credit_receipt_envelope(p_receipt) is true and p_receipt->'httpStatus'='200'::jsonb
   and icash_research_private.capacity_probe_response_fresh(p_receipt,c.started_at,stamp) is true
   and q.admitted and q.kind='owner_preview' and q.account_id is null and q.operation_key='provider-credit-check:'||c.id
   and q.created_at>=c.started_at-interval '1 second' and q.finished_at>=q.created_at and q.finished_at<=stamp
   and q.result->>'outcome'='response' and q.result->'httpStatus'='200'::jsonb and not q.result?'creditsUsed'
   and jsonb_typeof(raw#>'{plan,name}')='string' and length(raw#>>'{plan,name}') between 1 and 200
   and raw#>'{plan,is_paid}'='true'::jsonb
   and icash_research_private.credit_count(raw#>'{credits,total_cap}') and icash_research_private.credit_count(raw#>'{credits,total_available}')
   and icash_research_private.credit_count(raw#>'{credits,used}')
   and (not (raw->'credits' ? 'remaining') or (icash_research_private.credit_count(raw#>'{credits,remaining}')
    and raw#>'{credits,remaining}'=raw#>'{credits,total_available}'))
   and jsonb_typeof(raw#>'{billing_cycle,start}')='string' and jsonb_typeof(raw#>'{billing_cycle,end}')='string'
   and raw#>>'{billing_cycle,start}'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   and raw#>>'{billing_cycle,end}'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
  cycle_start:=(raw#>>'{billing_cycle,start}')::timestamptz;cycle_finish:=(raw#>>'{billing_cycle,end}')::timestamptz;
  valid:=valid and isfinite(cycle_start) and isfinite(cycle_finish) and cycle_start<=stamp and cycle_finish>stamp and cycle_finish>cycle_start;
  amount:=(raw#>>'{credits,total_available}')::bigint;
 exception when others then valid:=false;
 end;
 if valid is true then
  decision:=case when amount=0 then 'provider_credit_exhausted' else 'provider_credit_available' end;
  update icash_research_private.dealmachine_credit_state set blocked=amount=0,available=amount,cycle_end=cycle_finish,
   latest_usage_at=stamp,latest_usage_generation=c.generation where id=1;
 end if;
 update icash_research_private.dealmachine_credit_checks set receipt=p_receipt,result=decision,received_at=stamp where id=c.id;
 return decision;
end$$;

-- Admit no new paid request after exact exhaustion, including starter reserve.
-- All prior quota/exclusion checks and every unrelated kind remain unchanged.
do $patch$
declare d text;needle text:=' -- Recheck time after waiting on the limiter';replacement text;
begin
 d:=pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Provider credit request gate boundary changed';end if;
 replacement:=' if p_kind in (''owner_lookup'',''property_search'',''buyer_search'',''property_lookup'')
  and exists(select 1 from icash_research_private.dealmachine_credit_state where id=1 and enabled and blocked) then
  if p_request is not null then insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)
   values(p_request,p_kind,p_account,p_operation,false,''{"outcome":"provider_credit_exhausted"}''::jsonb);end if;
  return false;
 end if;
'||needle;
 execute replace(d,needle,replacement);
end $patch$;

create function icash_research_private.credit_export_source(p_export uuid,p_hash text) returns boolean
language plpgsql stable set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;q icash_research_private.requests;
begin
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 select * into q from icash_research_private.requests where id=p_export;
 return coalesce(e.id is not null and b.id is not null and q.id is not null and e.terminal_at is null and e.completed_at is null and e.capacity_review_id is null
  and e.recovery is null and e.csv is null and (e.lease_until is null or e.lease_until<=now()) and b.state='claimed' and b.results is null
  and p_hash=md5(e.receipt::text) and b.paid_receipt=e.receipt->'raw' and icash_research_private.credit_refusal_exact(e.receipt)
  and q.account_id=b.account_id and q.kind='owner_lookup' and q.operation_key='owner-batch:'||e.id and q.admitted
  and q.finished_at>=q.created_at and q.finished_at<=now() and q.result->>'outcome'='http_error' and q.result->'httpStatus'='402'::jsonb and not q.result?'creditsUsed'
  and e.request-'people_ids'=jsonb_build_object('limit',jsonb_array_length(e.request->'people_ids'),'anchor','person',
   'fields','["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb,
   'scrub_dnc',true,'require_phone',true,'property_match','owner','active_phones_only',true)
  and (select count(distinct v) from jsonb_array_elements(e.request->'people_ids') v)=jsonb_array_length(e.request->'people_ids')
  and jsonb_typeof(e.request->'people_ids')='array' and jsonb_array_length(e.request->'people_ids') between 1 and 125
  and not exists(select 1 from jsonb_array_elements(e.request->'people_ids') v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^per_[0-9]{1,100}$')
  and not exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null),false);
exception when others then return false;
end$$;
alter function icash_research_private.capacity_source_policy(uuid,text) rename to capacity_source_before_credit;
create function icash_research_private.capacity_source_policy(p_export uuid,p_hash text) returns text
language plpgsql stable set search_path='' as $$declare prior text;begin
 prior:=icash_research_private.capacity_source_before_credit(p_export,p_hash);if prior is not null then return prior;end if;
 if exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled)
  and exists(select 1 from icash_research_private.dealmachine_credit_state where id=1 and enabled and not blocked and available>0
   and latest_usage_generation=generation and latest_usage_at>=latest_refusal_at and latest_usage_at>=now()-interval '15 minutes')
  and icash_research_private.credit_export_source(p_export,p_hash)
  and exists(select 1 from icash_research_private.dealmachine_credit_refusals f
   join icash_research_private.requests q on q.id=f.request_id join icash_research_private.owner_exports e on e.id=q.id
   where f.request_id=p_export and f.request_snapshot=to_jsonb(q) and f.receipt-'headers'=e.receipt-'headers' and f.export_request=e.request) then return 'credit-idle-v1';end if;
 return null;
end$$;
alter table icash_research_private.owner_export_capacity_reviews drop constraint owner_export_capacity_reviews_auto_policy_check;
alter table icash_research_private.owner_export_capacity_reviews add constraint owner_export_capacity_reviews_auto_policy_check
 check(auto_policy is null or auto_policy in ('idle-v1','gateway-idle-v1','empty-idle-v1','unknown-idle-v1','credit-idle-v1'));
do $patch$
declare sig text;d text;needle text:='(''idle-v1'',''gateway-idle-v1'',''empty-idle-v1'',''unknown-idle-v1'')';
begin
 foreach sig in array array['icash_research_private.guard_capacity_precision_followup()','public.icash_claim_export_capacity_probe(uuid,text)','public.icash_finish_automatic_export_capacity(uuid)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Provider credit capacity family boundary changed: %',sig;end if;
  d:=replace(d,needle,'(''idle-v1'',''gateway-idle-v1'',''empty-idle-v1'',''unknown-idle-v1'',''credit-idle-v1'')');
  if sig='public.icash_finish_automatic_export_capacity(uuid)' then
   -- Credit rejection creates no export row, but still requires all three
   -- fresh authenticated inventory receipts and retains the original hold.
   d:=replace(d,'if r.auto_policy=''unknown-idle-v1'' and icash_research_private.capacity_probe_response_fresh',
    'if r.auto_policy in (''unknown-idle-v1'',''credit-idle-v1'') and icash_research_private.capacity_probe_response_fresh');
   d:=replace(d,'r.auto_policy in (''empty-idle-v1'',''unknown-idle-v1'') or latest',
    'r.auto_policy in (''empty-idle-v1'',''unknown-idle-v1'',''credit-idle-v1'') or latest');
  end if;
  execute d;
 end loop;
end $patch$;

-- Keep the original admitted requests that give these immutable receipts meaning.
do $patch$
declare d text;needle text:=' order by request.created_at limit 10000';
begin
 d:=pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Provider credit retention boundary changed';end if;
 execute replace(d,needle,' and not exists(select 1 from icash_research_private.dealmachine_credit_refusals proof where proof.request_id=request.id) and not exists(select 1 from icash_research_private.dealmachine_credit_checks proof where proof.request_id=request.id)'||needle);
end $patch$;

-- Import only the exact active original, never blanket historical requests.
do $$declare e record;begin
 for e in select x.id,x.receipt from icash_research_private.owner_exports x
  where x.terminal_at is null and x.capacity_review_id is null
   and icash_research_private.credit_export_source(x.id,md5(x.receipt::text)) loop
  perform public.icash_record_dealmachine_credit_refusal(e.id,e.receipt);
 end loop;
end$$;
-- Preserve activation/release metadata and all other existing manifest slots.
update icash_research_private.owner_export_quota_policy set function_hashes=jsonb_set(jsonb_set(function_hashes,
 array['icash_research_private.take_reserved_request(text,uuid,text,uuid)'],to_jsonb(md5(pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure)))),array['public.icash_prune_research_requests()'],to_jsonb(md5(pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure)))) where id=1;
update icash_research_private.dealmachine_credit_state set function_hashes=(select jsonb_object_agg(sig,md5(pg_get_functiondef(sig::regprocedure))) from unnest(array[
 'public.icash_claim_dealmachine_credit_check(text)','public.icash_record_dealmachine_credit_check(uuid,jsonb)','public.icash_record_dealmachine_credit_refusal(uuid,jsonb)',
 'public.icash_dealmachine_credit_status()','icash_research_private.credit_export_source(uuid,text)','icash_research_private.credit_refusal_exact(jsonb)',
 'icash_research_private.credit_count(jsonb)','icash_research_private.credit_receipt_envelope(jsonb)','icash_research_private.guard_dealmachine_credit_evidence()',
 'icash_research_private.take_reserved_request(text,uuid,text,uuid)','icash_research_private.capacity_source_policy(uuid,text)',
 'icash_research_private.capacity_source_before_credit(uuid,text)','icash_research_private.guard_capacity_precision_followup()',
 'public.icash_claim_export_capacity_probe(uuid,text)','public.icash_finish_automatic_export_capacity(uuid)',
 'public.icash_finish_dealmachine_request(uuid,jsonb)','public.icash_record_owner_export_receipt(uuid,uuid,jsonb)',
 'public.icash_claim_automatic_export_capacity(text)','public.icash_prune_research_requests()',
 'icash_research_private.capacity_probe_response_fresh(jsonb,timestamptz,timestamptz)']) sig) where id=1;
create function icash_research_private.activate_dealmachine_credit_wait(p_release text) returns boolean
language plpgsql set search_path='' as $$declare s icash_research_private.dealmachine_credit_state;expected text[]:=array[
 'public.icash_claim_dealmachine_credit_check(text)','public.icash_record_dealmachine_credit_check(uuid,jsonb)','public.icash_record_dealmachine_credit_refusal(uuid,jsonb)',
 'public.icash_dealmachine_credit_status()','icash_research_private.credit_export_source(uuid,text)','icash_research_private.credit_refusal_exact(jsonb)',
 'icash_research_private.credit_count(jsonb)','icash_research_private.credit_receipt_envelope(jsonb)','icash_research_private.guard_dealmachine_credit_evidence()',
 'icash_research_private.take_reserved_request(text,uuid,text,uuid)','icash_research_private.capacity_source_policy(uuid,text)',
 'icash_research_private.capacity_source_before_credit(uuid,text)','icash_research_private.guard_capacity_precision_followup()',
 'public.icash_claim_export_capacity_probe(uuid,text)','public.icash_finish_automatic_export_capacity(uuid)',
 'public.icash_finish_dealmachine_request(uuid,jsonb)','public.icash_record_owner_export_receipt(uuid,uuid,jsonb)',
 'public.icash_claim_automatic_export_capacity(text)','public.icash_prune_research_requests()',
 'icash_research_private.capacity_probe_response_fresh(jsonb,timestamptz,timestamptz)'];begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 select * into s from icash_research_private.dealmachine_credit_state where id=1 for update;
 if not found or jsonb_typeof(s.function_hashes) is distinct from 'object' or not (s.function_hashes ?& expected)
  or (select count(*) from jsonb_object_keys(s.function_hashes))<>cardinality(expected)
  or exists(select 1 from jsonb_each_text(s.function_hashes) h where to_regprocedure(h.key) is null or h.value is distinct from md5(pg_get_functiondef(to_regprocedure(h.key)))) then return false;end if;
 if s.enabled then return s.release_sha=p_release;end if;if s.activated_at is not null then return false;end if;
 update icash_research_private.dealmachine_credit_state set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;return true;
end$$;
revoke all on function icash_research_private.guard_dealmachine_credit_evidence(),icash_research_private.credit_count(jsonb),icash_research_private.credit_receipt_envelope(jsonb),
 icash_research_private.credit_refusal_exact(jsonb),icash_research_private.credit_export_source(uuid,text),icash_research_private.capacity_source_before_credit(uuid,text),
 icash_research_private.capacity_source_policy(uuid,text),icash_research_private.activate_dealmachine_credit_wait(text),
 public.icash_claim_dealmachine_credit_check(text),public.icash_record_dealmachine_credit_check(uuid,jsonb),public.icash_record_dealmachine_credit_refusal(uuid,jsonb),public.icash_dealmachine_credit_status()
 from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_dealmachine_credit_check(text),public.icash_record_dealmachine_credit_check(uuid,jsonb),public.icash_record_dealmachine_credit_refusal(uuid,jsonb),public.icash_dealmachine_credit_status() to service_role;
notify pgrst,'reload schema';
