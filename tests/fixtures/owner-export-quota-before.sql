-- Synthetic native-only relations and dependency boundaries; no customer rows.
-- The guarded functions below are exact read-only production definitions.
create schema icash_research_private;
create table public.icash_dealmachine_request_budget(
 id integer primary key,minute_start timestamptz not null,minute_used integer not null,minute_limit integer not null,
 day_start timestamptz not null,day_used integer not null,day_limit integer not null
);
insert into public.icash_dealmachine_request_budget values(1,now(),0,1000,now(),0,10000);
create table public.native_fixture_quota(id integer primary key,available boolean not null);
insert into public.native_fixture_quota values(1,true);
create function public.icash_dealmachine_provider_available() returns boolean language sql stable as $$select available from public.native_fixture_quota where id=1$$;
create function icash_research_private.request_reserve_state(stamp timestamptz) returns jsonb language sql stable as $$select jsonb_build_object('ordinaryRemaining',greatest(0,day_limit-day_used),'reserveRemaining',0,'maintenanceRemaining',0) from public.icash_dealmachine_request_budget where id=1$$;
create function icash_research_private.maintenance_exclusion_allowed(p_operation text,stamp timestamptz) returns boolean language sql stable as $$select false$$;
create function icash_research_private.starter_exclusion_request_allowed(p_account uuid,p_operation text,stamp timestamptz) returns boolean language sql stable as $$select false$$;
create function icash_research_private.starter_request_allowance(p_account uuid,stamp timestamptz) returns integer language sql stable as $$select 0$$;
create table public.icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);
create table icash_research_private.exclusions(id integer primary key,token uuid,list_id text);
create table icash_research_private.requests(
 id uuid primary key,kind text not null,account_id uuid,operation_key text,admitted boolean not null,
 created_at timestamptz not null default now(),finished_at timestamptz,result jsonb
);
create index research_requests_created on icash_research_private.requests(created_at desc,kind);
create index research_requests_account on icash_research_private.requests(account_id,created_at desc);
create index research_requests_operation on icash_research_private.requests(operation_key,kind) where admitted and operation_key is not null;
create index research_requests_operation_started on icash_research_private.requests(operation_key,created_at) where admitted;
create table icash_research_private.request_reserve_admissions(request_id uuid primary key,account_id uuid,day_start timestamptz,first_funded_at timestamptz,created_at timestamptz);
create table icash_research_private.maintenance_request_admissions(request_id uuid primary key,token uuid,list_id text,protected boolean,day_start timestamptz,created_at timestamptz);
create table icash_research_private.quota_feedback(id integer primary key,request_id uuid,request_started_at timestamptz,observed_at timestamptz,headers jsonb,blocked_until timestamptz);
insert into icash_research_private.quota_feedback(id) values(1);
create table icash_research_private.estimates(operation_key text primary key,updated_at timestamptz,lease_until timestamptz);
create table icash_research_private.owner_preflight_quota_deferrals(request_id uuid primary key);
create table icash_research_private.preview_rejection_recoveries(request_id uuid primary key);
create table icash_research_private.stalled_searches(request_id uuid primary key);
create table icash_research_private.owner_empty_preview_receipts(request_id uuid primary key);
create table icash_research_private.export_capacity_probes(request_id uuid primary key);
create table icash_research_private.owner_batches(
 id uuid primary key,account_id uuid not null,primary_screening uuid not null,created_at timestamptz not null default now(),
 state text not null default 'claimed',items jsonb not null default '[]',preview_receipt jsonb not null default '{}',paid_receipt jsonb,results jsonb
);
create table icash_research_private.owner_export_settings(id integer primary key check(id=1),enabled boolean not null default false,cached_artifact_recovery_enabled boolean not null default false);
insert into icash_research_private.owner_export_settings values(1,true,false);
create table icash_research_private.owner_exports(
 id uuid primary key references icash_research_private.owner_batches(id),request jsonb not null,
 receipt jsonb,recovery jsonb,recovery_history jsonb not null default '[]',csv text,artifact_sha256 text,parsed_rows jsonb,
 terminal_at timestamptz,completed_at timestamptz,next_recover_at timestamptz not null default now(),
 recovery_attempts integer not null default 0,lease_token uuid,lease_until timestamptz,capacity_review_id uuid,cached_artifact_attempts integer not null default 0
);
create unique index owner_export_one_pending on icash_research_private.owner_exports((true)) where terminal_at is null;
create index owner_export_recovery_due on icash_research_private.owner_exports(next_recover_at) where completed_at is null and receipt is not null and recovery_attempts<6;

CREATE OR REPLACE FUNCTION icash_research_private.guard_owner_export()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='DELETE' then raise exception 'Original export evidence is immutable';end if;
 if old.id is distinct from new.id or old.request is distinct from new.request
  or (old.receipt is not null and old.receipt is distinct from new.receipt)
  or (old.csv is not null and row(old.csv,old.artifact_sha256) is distinct from row(new.csv,new.artifact_sha256))
  or (old.parsed_rows is not null and old.parsed_rows is distinct from new.parsed_rows)
  or (old.terminal_at is not null and old.terminal_at is distinct from new.terminal_at)
  or (old.completed_at is not null and old is distinct from new)
  or new.recovery_attempts<old.recovery_attempts or new.cached_artifact_attempts<old.cached_artifact_attempts
  or not (new.recovery_history @> old.recovery_history) then raise exception 'Original export evidence is immutable';end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_owner_export_recovery(p_batch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;token uuid:=gen_random_uuid();local_only boolean;local_enabled boolean;
begin
 select cached_artifact_recovery_enabled into local_enabled from icash_research_private.owner_export_settings where id=1;
 select x.* into e from icash_research_private.owner_exports x where (p_batch is null or x.id=p_batch) and x.completed_at is null and x.receipt is not null
  and coalesce(x.receipt->'raw'->>'export_id','') ~ '^[-a-zA-Z0-9_]{1,128}$'
  and (x.recovery_attempts<6 or (local_enabled and x.recovery_attempts>=6 and x.cached_artifact_attempts<3
   and x.terminal_at is not null and octet_length(x.csv) between 1 and 1048576
   and x.artifact_sha256=encode(sha256(convert_to(x.csv,'UTF8')),'hex')
   and x.receipt->'httpStatus'='200'::jsonb and x.recovery->'httpStatus'='200'::jsonb
   and x.recovery->'raw'->'data'->>'status'='completed'
   and x.recovery->'raw'->'data'->>'export_id'=x.receipt->'raw'->>'export_id'
   and x.recovery->'raw'->'data'->'record_count'=x.receipt->'raw'->'record_count'
   and exists(select 1 from icash_research_private.owner_batches bound where bound.id=x.id and bound.paid_receipt=x.receipt->'raw')))
  and x.next_recover_at<=clock_timestamp() and (x.lease_until is null or x.lease_until<clock_timestamp())
 order by x.next_recover_at,x.id limit 1 for update skip locked;
 if not found then return null;end if;
 local_only:=e.recovery_attempts>=6;
 select * into strict b from icash_research_private.owner_batches where id=e.id;
 update icash_research_private.owner_exports set lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',
  recovery_attempts=recovery_attempts+case when local_only then 0 else 1 end,
  cached_artifact_attempts=cached_artifact_attempts+case when local_only then 1 else 0 end,
  next_recover_at=clock_timestamp()+interval '10 minutes' where id=e.id;
 return jsonb_build_object('id',e.id,'accountId',b.account_id,'createdAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'items',b.items,'preview',b.preview_receipt,'request',e.request,'receipt',e.receipt,'recovery',e.recovery->'raw','csv',e.csv,'lease',token,
  'localOnly',local_only,'artifactSha256',e.artifact_sha256,'recoveryHttpStatus',e.recovery->'httpStatus','terminalAt',e.terminal_at);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_record_owner_export_artifact(p_batch uuid, p_lease uuid, p_csv text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e icash_research_private.owner_exports;
begin
 select * into e from icash_research_private.owner_exports where id=p_batch and lease_token=p_lease and lease_until>clock_timestamp() and completed_at is null for update;
 if not found or p_csv is null or octet_length(p_csv)>1048576 or e.recovery->'httpStatus' is distinct from '200'::jsonb
  or e.recovery->'raw'->'data'->>'status' is distinct from 'completed'
  or e.recovery->'raw'->'data'->>'export_id' is distinct from e.receipt->'raw'->>'export_id' then return false;end if;
 if e.csv is not null then return e.csv=p_csv;end if;
 update icash_research_private.owner_exports set csv=p_csv,artifact_sha256=encode(sha256(convert_to(p_csv,'UTF8')),'hex') where id=p_batch;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_record_owner_export_recovery(p_batch uuid, p_lease uuid, p_receipt jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e icash_research_private.owner_exports;d jsonb:=p_receipt->'raw'->'data';
begin
 select * into e from icash_research_private.owner_exports where id=p_batch and lease_token=p_lease and lease_until>clock_timestamp() and completed_at is null for update;
 if not found or p_receipt is null or octet_length(p_receipt::text)>524288 then return false;end if;
 update icash_research_private.owner_exports set recovery=p_receipt,recovery_history=recovery_history||jsonb_build_array(p_receipt),
  terminal_at=case when terminal_at is not null then terminal_at when p_receipt->'httpStatus'='200'::jsonb and d->>'export_id'=e.receipt->'raw'->>'export_id' and d->>'status' in ('completed','failed') then clock_timestamp() else null end where id=p_batch;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_take_dealmachine_request(p_kind text, p_account uuid, p_operation text, p_request uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_request is null then return false;end if;
 return icash_research_private.take_reserved_request(p_kind,p_account,p_operation,p_request);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_prune_research_requests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer;
begin
 delete from icash_research_private.estimates where operation_key in (
  select operation_key from icash_research_private.estimates where updated_at<now()-interval '1 day'
   and (lease_until is null or lease_until<=now()) order by updated_at limit 1000 for update skip locked);
 delete from icash_research_private.requests where id in (select request.id from icash_research_private.requests request where request.created_at<now()-interval '30 days' and not exists(select 1 from icash_research_private.owner_preflight_quota_deferrals proof where proof.request_id=request.id) and not exists(select 1 from icash_research_private.preview_rejection_recoveries proof where proof.request_id=request.id) and not exists(select 1 from icash_research_private.stalled_searches proof where proof.request_id=request.id) and not exists(select 1 from icash_research_private.owner_empty_preview_receipts proof where proof.request_id=request.id) and not exists(select 1 from icash_research_private.export_capacity_probes proof where proof.request_id=request.id) order by request.created_at limit 10000);
 get diagnostics n=row_count;return n;
end $function$
;
-- Preserve the two exact single-space body lines in the captured function
-- hash without introducing trailing whitespace in this fixture source.
do $fixture$begin
 execute replace($exact$CREATE OR REPLACE FUNCTION public.icash_finish_dealmachine_request(p_request uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text;v jsonb;clean jsonb;
begin
 if coalesce(p_result->>'outcome','') not in ('response','http_error','unknown') or jsonb_typeof(p_result) is distinct from 'object' then return false;end if;
 clean:=jsonb_build_object('outcome',p_result->>'outcome');
 foreach k in array array['httpStatus','returned','creditsUsed','minuteRemaining','dayRemaining','retryAfter','minuteLimit','minuteReset','dayLimit'] loop
  v:=p_result->k;
  if v is not null and v<>'null'::jsonb then
   if jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]{1,10}$' then return false;end if;
   clean:=clean||jsonb_build_object(k,v);
  end if;
 end loop;
 update icash_research_private.requests set finished_at=now(),result=clean where id=p_request and admitted and finished_at is null;
__ICASH_CAPTURED_SINGLE_SPACE__
 if not found then return false;end if;
 -- The response belongs to a durable admitted request. Retain its original
 -- observation even if another response arrived sooner; latest metadata uses
 -- request start order, and an older 429 can only extend an existing hold.
 update icash_research_private.quota_feedback f set
  request_id=case when f.request_started_at is null or r.created_at>=f.request_started_at then r.id else f.request_id end,
  request_started_at=greatest(f.request_started_at,r.created_at),observed_at=now(),
  headers=case when f.request_started_at is null or r.created_at>=f.request_started_at then clean else f.headers end,
  blocked_until=greatest(f.blocked_until,
   case when clean->>'httpStatus'='429' then now()+make_interval(secs=>least(86400,greatest(1,coalesce((clean->>'retryAfter')::bigint,60)))::integer)
    when clean->>'minuteRemaining'='0' and (clean->>'minuteReset')::bigint between extract(epoch from now()) and extract(epoch from now()+interval '2 minutes') then to_timestamp((clean->>'minuteReset')::bigint)
   end)
 from icash_research_private.requests r where f.id=1 and r.id=p_request and r.admitted;
 return true;
__ICASH_CAPTURED_SINGLE_SPACE__
end $function$
;
$exact$,'__ICASH_CAPTURED_SINGLE_SPACE__',chr(32));
end $fixture$;
CREATE OR REPLACE FUNCTION icash_research_private.take_reserved_request(p_kind text, p_account uuid, p_operation text, p_request uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.icash_dealmachine_request_budget;s jsonb;allowed boolean:=false;protected boolean:=false;maintenance boolean:=false;bound_sync boolean:=false;
 stamp timestamptz;first_funded timestamptz;
begin
 if p_request is not null and (p_kind is null or p_kind not in ('search_estimate','property_search','owner_preview','owner_lookup','exclusion_create','exclusion_sync','geography','buyer_estimate','buyer_search','property_lookup','photo','phone_dnc')
  or length(coalesce(p_operation,''))>200) then return false;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found then return false;end if;
 if p_request is not null and (exists(select 1 from icash_research_private.requests where id=p_request)
  or exists(select 1 from icash_research_private.request_reserve_admissions where request_id=p_request)
  or exists(select 1 from icash_research_private.maintenance_request_admissions where request_id=p_request)) then return false;end if;
 -- Recheck time after waiting on the limiter, so a stale transaction cannot
 -- extend the new account's first 24 hours or the provider's rolling window.
 stamp:=clock_timestamp();
 s:=icash_research_private.request_reserve_state(stamp);
 bound_sync:=p_request is not null and p_account is null and p_kind='exclusion_sync'
  and icash_research_private.maintenance_exclusion_allowed(p_operation,stamp);
 if s is not null and public.icash_dealmachine_provider_available()
  and b.minute_start<=stamp and b.minute_used>=0 and b.minute_limit>0 then
  if b.minute_start<=stamp-interval '1 minute' then b.minute_start:=stamp;b.minute_used:=0;end if;
  if b.day_start<=stamp-interval '24 hours' then b.day_start:=stamp;b.day_used:=0;end if;
  if b.minute_used<b.minute_limit and b.day_used<b.day_limit then
   -- Only a live exact attached-list sync may use the bounded maintenance lane.
   -- Never list creation/recovery, paid work, caller-supplied labels or starter money.
   if bound_sync and (s->>'maintenanceRemaining')::integer>0 then
    allowed:=true;maintenance:=true;
   else
    allowed:=(s->>'ordinaryRemaining')::integer>0;
   end if;
   if not allowed and p_request is not null and p_operation is not null and length(p_operation)>0
    and (p_kind in ('search_estimate','property_search','owner_preview','owner_lookup','geography','property_lookup')
    or (p_kind='exclusion_sync' and icash_research_private.starter_exclusion_request_allowed(p_account,p_operation,stamp)))
    and (s->>'reserveRemaining')::integer>0
    and icash_research_private.starter_request_allowance(p_account,stamp)>0 then
    allowed:=true;protected:=true;
   end if;
  end if;
 end if;
 if p_operation like 'maintenance-exclusion:%' and not coalesce(bound_sync,false) then allowed:=false;end if;
 if p_request is not null then
  insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)
   values(p_request,p_kind,p_account,p_operation,allowed,case when allowed then null else '{"outcome":"quota_wait"}'::jsonb end);
 end if;
 if not allowed then return false;end if;
 if bound_sync then
  insert into icash_research_private.maintenance_request_admissions(request_id,token,list_id,protected,day_start,created_at)
   select p_request,e.token,e.list_id,maintenance,b.day_start,stamp from icash_research_private.exclusions e
    where e.id=1 and p_operation='maintenance-exclusion:'||e.token;
  if not found then raise exception 'Maintenance request binding changed';end if;
 end if;
 if protected then
  select credited_at into first_funded from public.icash_funding_orders
   where account_id=p_account and mode='live' and state='paid' and credited_at is not null order by credited_at limit 1;
  insert into icash_research_private.request_reserve_admissions(request_id,account_id,day_start,first_funded_at,created_at)
   values(p_request,p_account,b.day_start,first_funded,stamp);
 end if;
 update public.icash_dealmachine_request_budget set minute_start=b.minute_start,minute_used=b.minute_used+1,
  day_start=b.day_start,day_used=b.day_used+1 where id=1;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_record_owner_export_receipt(p_account uuid, p_batch uuid, p_receipt jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e icash_research_private.owner_exports;r jsonb:=p_receipt->'raw';terminal boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
 select x.* into e from icash_research_private.owner_exports x join icash_research_private.owner_batches b on b.id=x.id where x.id=p_batch and b.account_id=p_account for update of x;
 if not found or jsonb_typeof(p_receipt) is distinct from 'object' or octet_length(p_receipt::text)>1100000 or jsonb_typeof(p_receipt->'httpStatus') is distinct from 'number' or (p_receipt->>'httpStatus')::integer not between 100 and 599 or jsonb_typeof(p_receipt->'rawText') is distinct from 'string' then return false;end if;
 if e.receipt is not null then return e.receipt=p_receipt;end if;
 if r is distinct from 'null'::jsonb and (p_receipt->>'rawText')::jsonb is distinct from r then return false;end if;
 if r is distinct from 'null'::jsonb and not public.icash_record_owner_batch_receipt(p_account,p_batch,r) then return false;end if;
 terminal:=p_receipt->'httpStatus'='200'::jsonb and coalesce(r->>'export_id','') ~ '^[-a-zA-Z0-9_]{1,128}$' and jsonb_typeof(r->'record_count')='number' and coalesce(r->>'record_count','') ~ '^[0-9]{1,3}$' and r->'file_count'='1'::jsonb;
 update icash_research_private.owner_exports set receipt=p_receipt,terminal_at=case when terminal then clock_timestamp() else null end where id=p_batch;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_record_owner_batch_receipt(p_account uuid, p_batch uuid, p_receipt jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b icash_research_private.owner_batches;
begin
 perform pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
 select * into b from icash_research_private.owner_batches where id=p_batch and account_id=p_account for update;
 if not found or p_receipt is null or octet_length(p_receipt::text)>2097152 then return false;end if;
 if b.paid_receipt is not null then return b.paid_receipt=p_receipt;end if;
 update icash_research_private.owner_batches set paid_receipt=p_receipt where id=p_batch;return true;
end $function$
;
create trigger owner_export_immutable before update or delete on icash_research_private.owner_exports for each row execute function icash_research_private.guard_owner_export();
alter table icash_research_private.owner_exports enable row level security;
alter table icash_research_private.owner_batches enable row level security;
alter table icash_research_private.owner_export_settings enable row level security;
alter table icash_research_private.requests enable row level security;
revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;
revoke all on all functions in schema icash_research_private from public,anon,authenticated,service_role;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.icash_claim_owner_export_recovery(uuid),public.icash_take_dealmachine_request(text,uuid,text,uuid),public.icash_finish_dealmachine_request(uuid,jsonb),public.icash_record_owner_export_recovery(uuid,uuid,jsonb),public.icash_record_owner_export_artifact(uuid,uuid,text),public.icash_prune_research_requests() to service_role;
