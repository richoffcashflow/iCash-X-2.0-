-- Install disabled. Quota waits do not consume original-ID GET recovery attempts.
-- Historical relief requires six exact never-admitted local refusals, not an unknown request.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.icash_claim_owner_export_recovery(uuid)'::regprocedure))<>'1c5aefff779470ef57affa078db51766'
  or md5(pg_get_functiondef('public.icash_take_dealmachine_request(text,uuid,text,uuid)'::regprocedure))<>'30650dfe6fde97bf912d8d3cda9692a3'
  or md5(pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure))<>'2182dcab3cb6a780911298ae8fbb8da7'
  or md5(pg_get_functiondef('public.icash_finish_dealmachine_request(uuid,jsonb)'::regprocedure))<>'dee972b5f2f482e8d302187125cfdd20'
  or md5(pg_get_functiondef('public.icash_record_owner_export_receipt(uuid,uuid,jsonb)'::regprocedure))<>'fe21f05f45821b0d1c38542a3fb79da8'
  or md5(pg_get_functiondef('public.icash_record_owner_batch_receipt(uuid,uuid,jsonb)'::regprocedure))<>'9ade38bec61e018add1de31629040e7c'
  or md5(pg_get_functiondef('icash_research_private.guard_owner_export()'::regprocedure))<>'c6138b97eea8ce47e8091976c269a57d'
  or md5(pg_get_functiondef('public.icash_record_owner_export_recovery(uuid,uuid,jsonb)'::regprocedure))<>'dfba272ff9b9fc0e053aec7aec04b73d'
  or md5(pg_get_functiondef('public.icash_record_owner_export_artifact(uuid,uuid,text)'::regprocedure))<>'cc5c84c462b6a94299c265c751780cfc'
  or md5(pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure))<>'9d903e10c0aa788a22d14a2b93493947'
 then raise exception 'Original export quota recovery prerequisite changed';end if;
end$$;
create table icash_research_private.owner_export_quota_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text,activated_at timestamptz,function_hashes jsonb not null default '{}'::jsonb
);
insert into icash_research_private.owner_export_quota_policy(id) values(1);
create table icash_research_private.owner_export_quota_continuations(
 batch_id uuid primary key references icash_research_private.owner_exports(id),account_id uuid not null,
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),enrolled_at timestamptz not null default clock_timestamp()
);
create table icash_research_private.owner_export_quota_requests(
 request_id uuid primary key references icash_research_private.requests(id),
 batch_id uuid not null references icash_research_private.owner_exports(id),
 phase text not null check(phase in ('original','ordinary','continuation')),ordinal integer check(ordinal between 1 and 6),
 lease_token uuid,recorded_at timestamptz not null default clock_timestamp(),
 check((ordinal is null)=(lease_token is null)),check(phase<>'original' or ordinal is null),unique(batch_id,phase,ordinal)
);
create index owner_export_quota_requests_batch on icash_research_private.owner_export_quota_requests(batch_id,phase);
create index owner_export_quota_request_source on icash_research_private.requests(operation_key,created_at,id)
 where operation_key like 'owner-export-recovery:%';
alter table icash_research_private.owner_export_quota_policy enable row level security;
alter table icash_research_private.owner_export_quota_continuations enable row level security;
alter table icash_research_private.owner_export_quota_requests enable row level security;
revoke all on icash_research_private.owner_export_quota_policy,icash_research_private.owner_export_quota_continuations,icash_research_private.owner_export_quota_requests from public,anon,authenticated,service_role;

create function icash_research_private.reject_owner_export_quota_change() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Original export quota evidence is immutable';end$$;
create trigger owner_export_quota_immutable before update or delete or truncate on icash_research_private.owner_export_quota_continuations
 for each statement execute function icash_research_private.reject_owner_export_quota_change();
create trigger owner_export_quota_requests_immutable before update or delete or truncate on icash_research_private.owner_export_quota_requests
 for each statement execute function icash_research_private.reject_owner_export_quota_change();

-- Every admitted GET must have a known finished outcome and one receipt written
-- under that request's exact lease. Missing/unknown outcomes are never retried.
create function icash_research_private.owner_export_quota_history_ready(p_batch uuid) returns boolean
language sql stable set search_path='' as $$
 select not exists(
  select 1 from icash_research_private.owner_export_quota_requests q
  join icash_research_private.requests r on r.id=q.request_id
  join icash_research_private.owner_exports e on e.id=q.batch_id
  where q.batch_id=p_batch and q.ordinal is not null and (
   r.admitted is distinct from true or r.finished_at is null or jsonb_typeof(r.result->'httpStatus') is distinct from 'number' or coalesce(r.result->>'outcome','') not in ('response','http_error')
   or coalesce(r.result->>'httpStatus','')!~'^[1-5][0-9]{2}$'
   or (select count(*) from jsonb_array_elements(e.recovery_history) h where h->>'requestId'=q.request_id::text)<>1
   or not exists(select 1 from jsonb_array_elements(e.recovery_history) h
    where h->>'requestId'=q.request_id::text and h->>'requestLease'=q.lease_token::text
     and h->'httpStatus'=r.result->'httpStatus'
     and ((h->'httpStatus'='200'::jsonb and h->'raw'->'data'->>'export_id'=e.receipt->'raw'->>'export_id'
       and h->'raw'->'data'->>'status' in ('queued','pending','processing','completed'))
      or h->'httpStatus'='429'::jsonb or h->'httpStatus' between '500'::jsonb and '599'::jsonb))))
 and not exists(select 1 from icash_research_private.requests r
  join icash_research_private.owner_batches b on b.id=p_batch
  where r.operation_key='owner-export-recovery:'||p_batch and r.operation_key like 'owner-export-recovery:%' and r.admitted
   and (r.account_id is distinct from b.account_id or r.kind<>'owner_preview' or r.finished_at is null
    or coalesce(r.result->>'outcome','') not in ('response','http_error')
    or jsonb_typeof(r.result->'httpStatus') is distinct from 'number' or coalesce(r.result->>'httpStatus','')!~'^[1-5][0-9]{2}$'))
$$;

create function icash_research_private.owner_export_quota_source(p_batch uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;proof jsonb;ids jsonb;n integer;
begin
 select * into e from icash_research_private.owner_exports where id=p_batch;
 select * into b from icash_research_private.owner_batches where id=p_batch;
 if not found or b.state<>'claimed' or b.results is not null or b.created_at<=now()-interval '29 days' or b.created_at>now()
  or e.recovery_attempts<>6 or e.cached_artifact_attempts<>0 or e.completed_at is not null or e.terminal_at is null
  or e.terminal_at not between b.created_at and now()
  or not icash_research_private.owner_export_quota_history_ready(p_batch)
  or jsonb_array_length(e.recovery_history)<>(select count(*) from icash_research_private.owner_export_quota_requests q where q.batch_id=p_batch and q.phase='continuation' and q.ordinal is not null)
  or e.recovery is distinct from e.recovery_history->-1
  or e.csv is not null or e.artifact_sha256 is not null or e.parsed_rows is not null
  or e.receipt->'httpStatus' is distinct from '200'::jsonb or b.paid_receipt is distinct from e.receipt->'raw'
  or coalesce(e.receipt->'raw'->>'export_id','')!~'^[-a-zA-Z0-9_]{1,128}$' then return null;end if;
 -- Inspect the complete original operation key, not just a convenient subset.
 -- The retained window prevents a pruned admitted request from becoming absence proof.
 select count(*),jsonb_agg(jsonb_build_array(r.id,r.kind,r.account_id,r.operation_key,r.admitted,extract(epoch from r.created_at),r.finished_at,r.result) order by r.created_at,r.id),
  jsonb_agg(r.id order by r.created_at,r.id) into n,proof,ids
 from icash_research_private.requests r where r.operation_key='owner-export-recovery:'||e.id and r.operation_key like 'owner-export-recovery:%';
 if n<>6 or exists(select 1 from icash_research_private.requests r where r.operation_key='owner-export-recovery:'||e.id
  and r.operation_key like 'owner-export-recovery:%' and (r.account_id is distinct from b.account_id or r.kind<>'owner_preview'
   or r.admitted is distinct from false or r.result is distinct from '{"outcome":"quota_wait"}'::jsonb or r.finished_at is not null
   or r.created_at not between e.terminal_at and now())) then return null;end if;
 return jsonb_build_object('accountId',b.account_id,'requestIds',ids,'hash',encode(sha256(convert_to(jsonb_build_array(
  e.id,b.account_id,extract(epoch from b.created_at),b.primary_screening,b.items,b.preview_receipt,b.paid_receipt,
  e.request,e.receipt,extract(epoch from e.terminal_at),proof)::text,'UTF8')),'hex'));
end$$;

create function public.icash_claim_owner_export_quota_recovery(p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;c icash_research_private.owner_export_quota_continuations;
 proof jsonb;request_id uuid:=gen_random_uuid();token uuid:=gen_random_uuid();request_admitted boolean;attempt integer;
begin
 if not exists(select 1 from icash_research_private.owner_export_quota_policy where id=1 and enabled) then return null;end if;
 -- The existing request admission also takes this lock. Keep budget before export.
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 if not found then return null;end if;
 perform 1 from icash_research_private.owner_export_quota_policy where id=1 and enabled for share;
 if not found then return null;end if;
 select x.* into e from icash_research_private.owner_exports x
 where (p_batch is null or x.id=p_batch) and x.recovery_attempts=6 and x.completed_at is null and x.csv is null
  and x.next_recover_at<=clock_timestamp() and (x.lease_until is null or x.lease_until<clock_timestamp())
  and (select count(*) from icash_research_private.owner_export_quota_requests q where q.batch_id=x.id and q.phase='continuation' and q.ordinal is not null)<6
  and icash_research_private.owner_export_quota_source(x.id) is not null
 order by x.next_recover_at,x.id limit 1 for update of x skip locked;
 if not found then return null;end if;
 perform 1 from icash_research_private.requests where operation_key='owner-export-recovery:'||e.id and operation_key like 'owner-export-recovery:%' order by id for share;
 proof:=icash_research_private.owner_export_quota_source(e.id);
 if proof is null then return null;end if;
 select * into c from icash_research_private.owner_export_quota_continuations where batch_id=e.id;
 if found and (c.account_id::text is distinct from proof->>'accountId' or c.source_hash is distinct from proof->>'hash') then return null;end if;
 if not found then
  insert into icash_research_private.owner_export_quota_continuations(batch_id,account_id,source_hash) values(e.id,(proof->>'accountId')::uuid,proof->>'hash');
  insert into icash_research_private.owner_export_quota_requests(request_id,batch_id,phase)
   select value::uuid,e.id,'original' from jsonb_array_elements_text(proof->'requestIds');
 end if;
 request_admitted:=public.icash_take_dealmachine_request('owner_preview',(proof->>'accountId')::uuid,'owner-export-quota-recovery:'||e.id,request_id);
 if request_admitted is null or not exists(select 1 from icash_research_private.requests r where r.id=request_id and r.account_id=(proof->>'accountId')::uuid
  and r.kind='owner_preview' and r.operation_key='owner-export-quota-recovery:'||e.id and r.admitted=request_admitted and r.finished_at is null
  and ((request_admitted and r.result is null) or (not request_admitted and r.result='{"outcome":"quota_wait"}'::jsonb))) then raise exception 'Original export request admission unconfirmed';end if;
 select count(*)+1 into attempt from icash_research_private.owner_export_quota_requests q where q.batch_id=e.id and q.phase='continuation' and q.ordinal is not null;
 insert into icash_research_private.owner_export_quota_requests(request_id,batch_id,phase,ordinal,lease_token)
  values(request_id,e.id,'continuation',case when request_admitted then attempt end,case when request_admitted then token end);
 update icash_research_private.owner_exports set next_recover_at=clock_timestamp()+interval '10 minutes' where id=e.id;
 if not request_admitted then return null;end if;
 update icash_research_private.owner_exports set lease_token=token,lease_until=clock_timestamp()+interval '90 seconds' where id=e.id;
 select * into strict b from icash_research_private.owner_batches where id=e.id;
 return jsonb_build_object('id',e.id,'accountId',b.account_id,'createdAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'items',b.items,'preview',b.preview_receipt,'request',e.request,'receipt',e.receipt,'recovery',null,'csv',null,'lease',token,
  'localOnly',false,'atomicRecovery',true,'quotaRequestId',request_id);
end$$;

-- Preserve all original ordinary/cached-artifact selection and write predicates.
-- Only the provider branch changes: admit first, then count and lease once.
do $$declare d text;old_part text;new_part text;begin
 d:=pg_get_functiondef('public.icash_claim_owner_export_recovery(uuid)'::regprocedure);
 old_part:='local_enabled boolean;';new_part:='local_enabled boolean;atomic_enabled boolean;request_id uuid:=gen_random_uuid();request_admitted boolean;';
 if strpos(d,old_part)=0 then raise exception 'Original recovery declaration changed';end if;d:=replace(d,old_part,new_part);
 old_part:='begin
 select cached_artifact_recovery_enabled';
 new_part:='begin
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 select enabled into atomic_enabled from icash_research_private.owner_export_quota_policy where id=1 for share;
 atomic_enabled:=coalesce(atomic_enabled,false);
 select cached_artifact_recovery_enabled';
 if strpos(d,old_part)=0 then raise exception 'Original recovery entry changed';end if;d:=replace(d,old_part,new_part);
 old_part:='  and x.next_recover_at<=clock_timestamp()';
 new_part:='  and (x.csv is not null or (atomic_enabled and icash_research_private.owner_export_quota_history_ready(x.id))
   or (not atomic_enabled and not exists(select 1 from icash_research_private.owner_export_quota_requests q where q.batch_id=x.id and q.ordinal is not null)))
  and x.next_recover_at<=clock_timestamp()';
 if strpos(d,old_part)=0 then raise exception 'Original recovery due predicate changed';end if;d:=replace(d,old_part,new_part);
 old_part:=' update icash_research_private.owner_exports set lease_token=token';
 new_part:=' if atomic_enabled and e.csv is null then
  request_admitted:=public.icash_take_dealmachine_request(''owner_preview'',b.account_id,''owner-export-recovery:''||e.id,request_id);
  if request_admitted is null or not exists(select 1 from icash_research_private.requests r where r.id=request_id and r.account_id=b.account_id
   and r.kind=''owner_preview'' and r.operation_key=''owner-export-recovery:''||e.id and r.admitted=request_admitted and r.finished_at is null
   and ((request_admitted and r.result is null) or (not request_admitted and r.result=''{"outcome":"quota_wait"}''::jsonb))) then raise exception ''Original export request admission unconfirmed'';end if;
  insert into icash_research_private.owner_export_quota_requests(request_id,batch_id,phase,ordinal,lease_token)
   values(request_id,e.id,''ordinary'',case when request_admitted then e.recovery_attempts+1 end,case when request_admitted then token end);
  if not request_admitted then
   update icash_research_private.owner_exports set next_recover_at=clock_timestamp()+interval ''10 minutes'' where id=e.id;return null;
  end if;
 end if;
 update icash_research_private.owner_exports set lease_token=token';
 if strpos(d,old_part)=0 then raise exception 'Original recovery lease boundary changed';end if;d:=replace(d,old_part,new_part);
 old_part:='''terminalAt'',e.terminal_at);';
 new_part:='''terminalAt'',e.terminal_at)||case when atomic_enabled and e.csv is null then jsonb_build_object(''atomicRecovery'',true,''quotaRequestId'',request_id) else ''{}''::jsonb end;';
 if strpos(d,old_part)=0 then raise exception 'Original recovery result changed';end if;d:=replace(d,old_part,new_part);
 execute d;
end$$;

-- The existing fresh-lease receipt writer remains authoritative. Add exact
-- request binding for the atomic lane without rewriting its financial guards.
create function public.icash_record_owner_export_quota_recovery(p_batch uuid,p_lease uuid,p_request uuid,p_receipt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$begin
 if p_receipt is null or not exists(select 1 from icash_research_private.owner_export_quota_requests q
  join icash_research_private.requests r on r.id=q.request_id
  where q.batch_id=p_batch and q.request_id=p_request and q.lease_token=p_lease and q.ordinal is not null and r.admitted)
 then return false;end if;
 return public.icash_record_owner_export_recovery(p_batch,p_lease,p_receipt||jsonb_build_object('requestId',p_request,'requestLease',p_lease));
end$$;

do $$declare d text;needle text:=' order by request.created_at limit 10000';begin
 d:=pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Request retention boundary changed';end if;
 execute replace(d,needle,' and not exists(select 1 from icash_research_private.owner_export_quota_requests proof where proof.request_id=request.id)'||needle);
end$$;
-- Capture both new code and every existing predicate used by the lane.
update icash_research_private.owner_export_quota_policy set function_hashes=(
 select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
  'public.icash_claim_owner_export_recovery(uuid)','public.icash_claim_owner_export_quota_recovery(uuid)',
  'public.icash_record_owner_export_quota_recovery(uuid,uuid,uuid,jsonb)',
  'icash_research_private.reject_owner_export_quota_change()',
  'icash_research_private.owner_export_quota_source(uuid)','icash_research_private.owner_export_quota_history_ready(uuid)',
  'icash_research_private.take_reserved_request(text,uuid,text,uuid)','public.icash_take_dealmachine_request(text,uuid,text,uuid)',
  'public.icash_finish_dealmachine_request(uuid,jsonb)','icash_research_private.guard_owner_export()',
  'public.icash_record_owner_export_recovery(uuid,uuid,jsonb)','public.icash_record_owner_export_artifact(uuid,uuid,text)',
  'public.icash_record_owner_export_receipt(uuid,uuid,jsonb)','public.icash_record_owner_batch_receipt(uuid,uuid,jsonb)','public.icash_prune_research_requests()'
 ]) signature);
create function icash_research_private.activate_owner_export_quota_recovery(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$declare p icash_research_private.owner_export_quota_policy;expected text[]:=array[
  'public.icash_claim_owner_export_recovery(uuid)','public.icash_claim_owner_export_quota_recovery(uuid)',
  'public.icash_record_owner_export_quota_recovery(uuid,uuid,uuid,jsonb)',
  'icash_research_private.reject_owner_export_quota_change()',
  'icash_research_private.owner_export_quota_source(uuid)','icash_research_private.owner_export_quota_history_ready(uuid)',
  'icash_research_private.take_reserved_request(text,uuid,text,uuid)','public.icash_take_dealmachine_request(text,uuid,text,uuid)',
  'public.icash_finish_dealmachine_request(uuid,jsonb)','icash_research_private.guard_owner_export()',
  'public.icash_record_owner_export_recovery(uuid,uuid,jsonb)','public.icash_record_owner_export_artifact(uuid,uuid,text)',
  'public.icash_record_owner_export_receipt(uuid,uuid,jsonb)','public.icash_record_owner_batch_receipt(uuid,uuid,jsonb)','public.icash_prune_research_requests()'
 ];begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update;
 select * into p from icash_research_private.owner_export_quota_policy where id=1 for update;
 if not found or jsonb_typeof(p.function_hashes) is distinct from 'object' then return false;end if;
 if not (p.function_hashes ?& expected) or (select count(*) from jsonb_object_keys(p.function_hashes))<>cardinality(expected) then return false;end if;
 if exists(select 1 from jsonb_each_text(p.function_hashes) h where coalesce(h.value,'')!~'^[a-f0-9]{32}$'
  or h.value<>md5(pg_get_functiondef(h.key::regprocedure))) then return false;end if;
 if p.enabled then return p.release_sha=p_release;end if;
 if p.activated_at is not null then return false;end if;
 -- Do not switch an issued legacy lease into the atomic receipt contract.
 if exists(select 1 from icash_research_private.owner_exports e where e.completed_at is null and e.csv is null
  and e.lease_until>clock_timestamp() and not exists(select 1 from icash_research_private.owner_export_quota_requests q
   where q.batch_id=e.id and q.lease_token=e.lease_token and q.ordinal is not null)) then return false;end if;
 update icash_research_private.owner_export_quota_policy set enabled=true,activated_at=clock_timestamp(),release_sha=p_release where id=1;return true;
end$$;
revoke all on function icash_research_private.owner_export_quota_history_ready(uuid),icash_research_private.reject_owner_export_quota_change(),icash_research_private.owner_export_quota_source(uuid),icash_research_private.activate_owner_export_quota_recovery(text),public.icash_claim_owner_export_quota_recovery(uuid),public.icash_record_owner_export_quota_recovery(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_owner_export_quota_recovery(uuid),public.icash_record_owner_export_quota_recovery(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
