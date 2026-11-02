-- A completed provider gateway timeout keeps the original purchase and owners
-- held, but must not permanently consume the organization's export capacity.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.export_capacity_automation
 add column gateway_enabled boolean not null default false;
alter table icash_research_private.owner_export_capacity_reviews
 drop constraint owner_export_capacity_reviews_auto_policy_check;
alter table icash_research_private.owner_export_capacity_reviews
 add constraint owner_export_capacity_reviews_auto_policy_check
 check(auto_policy is null or auto_policy in ('idle-v1','gateway-idle-v1'));

do $check$begin
 if md5(pg_get_functiondef('icash_research_private.capacity_source_current(uuid,text)'::regprocedure))<>'d992101d03923da307e9f84a7a5b7b2f' then
  raise exception 'Export capacity source prerequisite changed';
 end if;
end $check$;
alter function icash_research_private.capacity_source_current(uuid,text) rename to capacity_source_before_gateway;

create function icash_research_private.capacity_source_policy(p_export uuid,p_hash text) returns text
language plpgsql stable set search_path='' as $fn$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;
begin
 if icash_research_private.capacity_source_before_gateway(p_export,p_hash) is true then return 'idle-v1';end if;
 if not exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled and gateway_enabled) then return null;end if;
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 if e.id is not null and b.id is not null and b.state='claimed' and b.paid_receipt is null
  and e.terminal_at is null and e.completed_at is null and e.capacity_review_id is null
  and e.recovery is null and e.csv is null and (e.lease_until is null or e.lease_until<=now())
  and md5(e.receipt::text)=p_hash and e.receipt->'httpStatus'='504'::jsonb
  and e.receipt->'raw'='null'::jsonb
  and octet_length(e.receipt->>'rawText') between 1 and 1048576
  and strpos(e.receipt->>'rawText','dealmachine.com | 504: Gateway time-out')>0
  and strpos(e.receipt->>'rawText','api.v2.dealmachine.com')>0
  and exists(select 1 from icash_research_private.requests q where q.id=e.id and q.account_id=b.account_id
   and q.kind='owner_lookup' and q.operation_key='owner-batch:'||e.id and q.admitted
   and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
   and q.result->>'outcome'='http_error' and q.result->'httpStatus'='504'::jsonb)
  and not exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null)
 then return 'gateway-idle-v1';end if;
 return null;
exception when others then return null;
end $fn$;

create function icash_research_private.capacity_source_current(p_export uuid,p_hash text) returns boolean
language sql stable set search_path='' as $fn$
 select icash_research_private.capacity_source_policy(p_export,p_hash) is not null;
$fn$;

-- Keep automatic attempts in their original policy family, including backoff.
do $patch$declare d text;begin
 d:=pg_get_functiondef('icash_research_private.guard_capacity_precision_followup()'::regprocedure);
 if md5(d)<>'5b3c66f2e52450bd45db24879099868c' then raise exception 'Capacity policy guard changed';end if;
 d:=replace(d,'if new.auto_policy=''idle-v1'' then','if new.auto_policy in (''idle-v1'',''gateway-idle-v1'') then');
 d:=replace(d,'p.auto_policy is distinct from ''idle-v1''','p.auto_policy is distinct from new.auto_policy');
 execute d;
 d:=pg_get_functiondef('public.icash_claim_automatic_export_capacity(text)'::regprocedure);
 if md5(d)<>'69f12c287cc20fb8c60cf9da4fc47e6a' then raise exception 'Capacity claim prerequisite changed';end if;
 d:=replace(d,'request uuid:=gen_random_uuid();','request uuid:=gen_random_uuid();source_policy text;');
 d:=replace(d,'select * into previous from icash_research_private.owner_export_capacity_reviews',
  'source_policy:=icash_research_private.capacity_source_policy(e.id,md5(e.receipt::text));'||E'\n select * into previous from icash_research_private.owner_export_capacity_reviews');
 d:=replace(d,'previous.auto_policy is distinct from ''idle-v1''','previous.auto_policy is distinct from source_policy');
 d:=replace(d,'p_release,''idle-v1'',coalesce(previous.auto_attempt,0)+1','p_release,source_policy,coalesce(previous.auto_attempt,0)+1');
 execute d;
 d:=pg_get_functiondef('public.icash_claim_export_capacity_probe(uuid,text)'::regprocedure);
 if md5(d)<>'7a8678c47d8ce5dc62b95654154adee8' then raise exception 'Capacity probe prerequisite changed';end if;
 execute replace(d,'r.auto_policy is distinct from ''idle-v1''','coalesce(r.auto_policy,'''') not in (''idle-v1'',''gateway-idle-v1'')');
 d:=pg_get_functiondef('public.icash_finish_automatic_export_capacity(uuid)'::regprocedure);
 if md5(d)<>'529d4d472abf8f6f0b0ab194921e1f9e' then raise exception 'Capacity finish prerequisite changed';end if;
 d:=replace(d,'r.auto_policy is distinct from ''idle-v1''','coalesce(r.auto_policy,'''') not in (''idle-v1'',''gateway-idle-v1'')');
 d:=replace(d,'jsonb_build_object(''policy'',''idle-v1'',''probes''','jsonb_build_object(''policy'',r.auto_policy,''probes''');
 execute d;
end $patch$;

revoke all on function icash_research_private.capacity_source_before_gateway(uuid,text),
 icash_research_private.capacity_source_policy(uuid,text),icash_research_private.capacity_source_current(uuid,text)
 from public,anon,authenticated,service_role;
commit;
