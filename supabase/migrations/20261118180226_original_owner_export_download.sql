-- A completed paid export can supply its own signed file. The ordinary
-- status-GET receipt and quota journal continue to represent actual GETs only.
set local lock_timeout='4s';
set local statement_timeout='25s';
do $guard$
declare item record; target regprocedure;
begin
 for item in select * from (values
  ('icash_research_private.guard_owner_export()','c6138b97eea8ce47e8091976c269a57d',false),
  ('public.icash_claim_owner_export_recovery(uuid)','010de0f859cb81a71221239fd6ba73e3',true),
  ('public.icash_record_owner_export_recovery(uuid,uuid,jsonb)','dfba272ff9b9fc0e053aec7aec04b73d',true),
  ('public.icash_record_owner_export_artifact(uuid,uuid,text)','cc5c84c462b6a94299c265c751780cfc',true),
  ('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)','7974d9beab87c3cbb6a034ee55ece451',true)
 ) v(signature,hash,service_access) loop
  target:=item.signature::regprocedure;
  if not exists(select 1 from pg_proc where oid=target and md5(pg_get_functiondef(oid))=item.hash
   and pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""'] and prosecdef=item.service_access
   and proacl::text=case when item.service_access then '{postgres=X/postgres,service_role=X/postgres}' else '{postgres=X/postgres}' end)
  then raise exception 'Unexpected original export function or access: %',item.signature; end if;
 end loop;
end $guard$;

alter table icash_research_private.owner_exports add column original_download_token uuid;

-- Only the inline handler with a freshly saved, finished purchase can claim
-- this once. A lost download or lease goes back to ordinary ID-based recovery.
create function public.icash_claim_original_owner_download(p_account uuid,p_batch uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 e icash_research_private.owner_exports;
 b icash_research_private.owner_batches;
 body jsonb;
 file jsonb;
 token uuid:=gen_random_uuid();
begin
 select * into b from icash_research_private.owner_batches where id=p_batch and account_id=p_account and state='claimed';
 if not found then return null; end if;
 select * into e from icash_research_private.owner_exports where id=p_batch and original_download_token is null
  and lease_token is null and recovery_attempts=0 and recovery is null and csv is null and completed_at is null
  and capacity_review_id is null and terminal_at between clock_timestamp()-interval '5 minutes' and clock_timestamp()
  for update skip locked;
 if not found then return null; end if;
 body:=e.receipt->'raw';
 if e.receipt->'httpStatus' is distinct from '200'::jsonb or body is distinct from b.paid_receipt
  or body->>'status' is distinct from 'completed' or coalesce(body->>'export_id','') !~ '^[-a-zA-Z0-9_]{1,128}$'
  or body->'file_count' is distinct from '1'::jsonb or jsonb_typeof(body->'record_count') is distinct from 'number'
  or coalesce(body->>'record_count','') !~ '^[1-9][0-9]{0,2}$'
  or jsonb_typeof(body->'download_urls') is distinct from 'array' then return null; end if;
 if (body->>'record_count')::int>jsonb_array_length(e.request->'people_ids') or jsonb_array_length(body->'download_urls')<>1 then return null; end if;
 file:=body#>'{download_urls,0}';
 if coalesce(file->>'url','') !~ '^https://storage[.]googleapis[.]com/[^?#[:space:]]+[?]' or length(file->>'url')>4096
  or position('#' in file->>'url')>0 or coalesce(file->>'filename','') !~* '[.]csv([.]gz)?$'
  or file->>'url' !~ '[?&]GoogleAccessId=[^&]+' or file->>'url' !~ '[?&]Expires=[0-9]+(&|$)' or file->>'url' !~ '[?&]Signature=[^&]+'
  or not exists(select 1 from icash_research_private.requests r where r.id=e.id and r.account_id=p_account
   and r.kind='owner_lookup' and r.operation_key='owner-batch:'||e.id and r.admitted and r.finished_at is not null
   and r.result->>'outcome'='response' and r.result->'httpStatus'='200'::jsonb
   and jsonb_typeof(r.result->'creditsUsed')='number' and r.result->'creditsUsed'=body#>'{credits,used}')
 then return null; end if;
 update icash_research_private.owner_exports set original_download_token=token,lease_token=token,
  lease_until=clock_timestamp()+interval '90 seconds' where id=e.id;
 return jsonb_build_object('id',e.id,'accountId',b.account_id,'createdAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'items',b.items,'preview',b.preview_receipt,'request',e.request,'receipt',e.receipt,'recovery',null,'csv',null,
  'lease',token,'originalDownload',true,'terminalAt',e.terminal_at);
end $fn$;
revoke all on function public.icash_claim_original_owner_download(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_original_owner_download(uuid,uuid) to service_role;

do $patch$
declare d text; old text;
begin
 d:=pg_get_functiondef('icash_research_private.guard_owner_export()'::regprocedure);
 old:='if old.id is distinct from new.id or old.request is distinct from new.request';
 execute replace(d,old,old||E'\n  or (old.original_download_token is not null and old.original_download_token is distinct from new.original_download_token)');

 d:=pg_get_functiondef('public.icash_record_owner_export_recovery(uuid,uuid,jsonb)'::regprocedure);
 old:='if not found or p_receipt is null';
 execute replace(d,old,'if not found or e.original_download_token=p_lease or p_receipt is null');

 d:=pg_get_functiondef('public.icash_record_owner_export_artifact(uuid,uuid,text)'::regprocedure);
 old:=$old$or e.recovery->'httpStatus' is distinct from '200'::jsonb
  or e.recovery->'raw'->'data'->>'status' is distinct from 'completed'
  or e.recovery->'raw'->'data'->>'export_id' is distinct from e.receipt->'raw'->>'export_id'$old$;
 execute replace(d,old,$new$or ((e.original_download_token=p_lease and e.recovery is null) is not true and ($new$||substr(old,4)||'))');

 -- CSV and its digest are write-once. A recovery GET sets recovery before
 -- storing its CSV, so only the original download can have CSV without one.
 d:=pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure);
 old:=$old$or e.recovery->'raw'->'data'->'record_count' is distinct from receipt->'record_count'$old$;
 execute replace(d,old,$new$or (e.recovery->'raw'->'data'->'record_count' is distinct from receipt->'record_count'
   and (e.original_download_token is not null and e.recovery is null and e.csv is not null
    and e.artifact_sha256=encode(sha256(convert_to(e.csv,'UTF8')),'hex') and b.paid_receipt=receipt) is not true)$new$);

 d:=pg_get_functiondef('public.icash_claim_owner_export_recovery(uuid)'::regprocedure);
 old:=$old$x.recovery->'httpStatus'='200'::jsonb
   and x.recovery->'raw'->'data'->>'status'='completed'
   and x.recovery->'raw'->'data'->>'export_id'=x.receipt->'raw'->>'export_id'
   and x.recovery->'raw'->'data'->'record_count'=x.receipt->'raw'->'record_count'$old$;
 d:=replace(d,old,'(('||old||') or (x.original_download_token is not null and x.recovery is null))');
 old:=$old$'terminalAt',e.terminal_at)||case when atomic_enabled$old$;
 execute replace(d,old,$new$'terminalAt',e.terminal_at)||case when e.original_download_token is not null and e.recovery is null and e.csv is not null
  then '{"originalArtifact":true}'::jsonb else '{}'::jsonb end||case when atomic_enabled$new$);
end $patch$;
