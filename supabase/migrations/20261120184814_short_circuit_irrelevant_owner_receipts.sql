-- Resolve the immutable batch key first. Most dispatched owner operations
-- do not have a verified no-match and need no review or receipt parsing.
set local lock_timeout='3s';
create index icash_verified_empty_export_keys on icash_research_private.owner_exports(id)
 where capacity_review_id is not null and receipt#>>'{raw,error,code}'='no_records_matched';
do $check$ begin
 if md5(pg_get_functiondef('icash_reliability_private.verified_empty_owner_export(public.icash_operation_spend)'::regprocedure))<>'07445b54b54401b4d289695c2d950047' then raise exception 'Owner planning source changed';end if;
end $check$;
create or replace function icash_reliability_private.verified_empty_owner_export(op public.icash_operation_spend)
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare batch_key uuid;
begin
 select i.batch_id into batch_key from icash_research_private.owner_batch_items i where i.operation_key=op.operation_key;
 if batch_key is null or not exists(select 1 from icash_research_private.owner_exports e where e.id=batch_key
  and e.capacity_review_id is not null and e.receipt#>>'{raw,error,code}'='no_records_matched') then return false;end if;
 return exists(
  select 1 from icash_research_private.owner_batch_items i
  join icash_research_private.owner_batches b on b.id=i.batch_id and b.account_id=op.account_id
  join icash_research_private.owner_exports e on e.id=b.id
  join icash_research_private.owner_export_capacity_reviews r on r.id=e.capacity_review_id and r.export_id=e.id
  join icash_research_private.requests q on q.id=b.id and q.account_id=b.account_id
  where i.batch_id=batch_key and e.id=batch_key and b.id=batch_key and q.id=batch_key and op.state='dispatched' and i.operation_key=op.operation_key and op.operation_key='owners:'||b.account_id||':'||i.screening_id
   and b.state='claimed' and b.results is null and b.paid_receipt=e.receipt->'raw'
   and e.terminal_at is null and e.completed_at is null and e.csv is null and e.artifact_sha256 is null
   and r.state='verified' and r.auto_policy='empty-idle-v1' and r.receipt_hash=md5(e.receipt::text)
   and e.receipt->'httpStatus'='400'::jsonb and e.receipt#>>'{raw,error,code}'='no_records_matched'
   and e.receipt#>>'{raw,error,request_id}' ~ '^req_[a-zA-Z0-9_-]+$'
   and case when pg_input_is_valid(e.receipt->>'rawText','jsonb') then (e.receipt->>'rawText')::jsonb=e.receipt->'raw' else false end
   and q.kind='owner_lookup' and q.operation_key='owner-batch:'||b.id and q.admitted
   and q.finished_at between q.created_at and now() and q.result->>'outcome'='http_error'
   and q.result->'httpStatus'='400'::jsonb and not q.result?'creditsUsed');
end $fn$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
begin
 if md5(src)<>'c442c57e364b3c6930794a424c80771c' then raise exception 'Voice queue source changed';end if;
 execute replace(src,$old$ if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets target
  on target.id=coalesce(v.permission_id,v.operational_contact_id) and target.account_id=v.account_id
  where v.state='ready' and v.due_at<=now() and target.revoked_at is null and target.permission_until>now())
  and exists(select 1 from icash_work_private.voice_queue_refresh_pacing
   where id=1 and refreshed_at between clock_timestamp()-interval '15 seconds' and clock_timestamp())
$old$,$new$ if exists(select 1 from icash_work_private.voice_queue_refresh_pacing pace
  where pace.id=1 and pace.refreshed_at between clock_timestamp()-interval '15 seconds' and clock_timestamp()
   and (pace.refreshed_at>=clock_timestamp()-interval '5 seconds' or exists(
    select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets target
    on target.id=coalesce(v.permission_id,v.operational_contact_id) and target.account_id=v.account_id
    where v.state='ready' and v.due_at<=now() and target.revoked_at is null and target.permission_until>now())))
$new$);
end $patch$;
