-- Install disabled until the matching handler and exact-release checks pass.
-- Reprocess only an original persisted artifact; never renew provider attempts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $prerequisites$
begin
 if md5(pg_get_functiondef('public.icash_claim_owner_export_recovery(uuid)'::regprocedure))<>'1dcb2e2b0fe7f2a8861706aefa817426'
  or md5(pg_get_functiondef('icash_research_private.guard_owner_export()'::regprocedure))<>'3770b4ab46c6bf405073ee3980460c2a' then raise exception 'Original export recovery prerequisite changed';end if;
end $prerequisites$;

alter table icash_research_private.owner_export_settings add column cached_artifact_recovery_enabled boolean not null default false;
alter table icash_research_private.owner_exports add column cached_artifact_attempts integer not null default 0 check(cached_artifact_attempts between 0 and 3);
create index owner_export_cached_artifact_due on icash_research_private.owner_exports(next_recover_at,id)
 where completed_at is null and receipt is not null and csv is not null and recovery_attempts>=6 and cached_artifact_attempts<3;

do $guard$
declare d text;
begin
 d:=pg_get_functiondef('icash_research_private.guard_owner_export()'::regprocedure);
 execute replace(d,'or new.recovery_attempts<old.recovery_attempts',
  'or new.recovery_attempts<old.recovery_attempts or new.cached_artifact_attempts<old.cached_artifact_attempts');
end $guard$;

create or replace function public.icash_claim_owner_export_recovery(p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.icash_claim_owner_export_recovery(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_owner_export_recovery(uuid) to service_role;
commit;
