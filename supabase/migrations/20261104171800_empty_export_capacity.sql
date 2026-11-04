-- A completed, exact no-records rejection is not a running export. Verify
-- organization idleness without retrying or settling that original purchase.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $check$
declare item record;
begin
 for item in select * from (values
  ('icash_research_private.capacity_source_policy(uuid,text)','48753180c59d072d26895597b2431b6c'),
  ('icash_research_private.guard_capacity_precision_followup()','d794c4c674b44ae95280cb733aaa753b'),
  ('public.icash_claim_automatic_export_capacity(text)','2bdb89367de2251258a2b26323694182'),
  ('public.icash_claim_export_capacity_probe(uuid,text)','0e848b64772ec999b41a7c6888a454cc'),
  ('public.icash_finish_automatic_export_capacity(uuid)','93adbddaf1bb222477988559ddca6581')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Empty export capacity prerequisite changed: %',item.signature;
  end if;
 end loop;
end $check$;
alter table icash_research_private.export_capacity_automation
 add column empty_enabled boolean not null default false;
alter table icash_research_private.owner_export_capacity_reviews
 drop constraint owner_export_capacity_reviews_auto_policy_check;
alter table icash_research_private.owner_export_capacity_reviews
 add constraint owner_export_capacity_reviews_auto_policy_check
 check(auto_policy is null or auto_policy in ('idle-v1','gateway-idle-v1','empty-idle-v1'));
alter function icash_research_private.capacity_source_policy(uuid,text) rename to capacity_source_before_empty;

create function icash_research_private.capacity_source_policy(p_export uuid,p_hash text) returns text
language plpgsql stable set search_path='' as $fn$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;prior text;
 message text:='No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.';
begin
 prior:=icash_research_private.capacity_source_before_empty(p_export,p_hash);
 if prior is not null then return prior;end if;
 if not exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled and empty_enabled) then return null;end if;
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 if e.id is not null and b.id is not null and b.state='claimed'
  and e.terminal_at is null and e.completed_at is null and e.capacity_review_id is null
  and e.recovery is null and e.csv is null and (e.lease_until is null or e.lease_until<=now())
  and md5(e.receipt::text)=p_hash and e.receipt->'httpStatus'='400'::jsonb
  and coalesce(e.receipt#>>'{raw,error,request_id}','') ~ '^req_[A-Za-z0-9_-]{1,100}$'
  and e.receipt->'raw'=jsonb_build_object('error',jsonb_build_object('code','invalid_request',
   'message',message,'request_id',e.receipt#>>'{raw,error,request_id}'))
  and (e.receipt->>'rawText')::jsonb=e.receipt->'raw' and b.paid_receipt=e.receipt->'raw'
  and exists(select 1 from icash_research_private.requests q where q.id=e.id and q.account_id=b.account_id
   and q.kind='owner_lookup' and q.operation_key='owner-batch:'||e.id and q.admitted
   and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
   and q.result->>'outcome'='http_error' and q.result->'httpStatus'='400'::jsonb)
  and not exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null)
 then return 'empty-idle-v1';end if;
 return null;
exception when others then return null;
end $fn$;

-- Preserve the existing admission locks, fresh three-probe requirements,
-- immutable reviews and bounded retry backoff for the new source family.
do $patch$
declare item record;d text;needle text:='(''idle-v1'',''gateway-idle-v1'')';
 replacement text:='(''idle-v1'',''gateway-idle-v1'',''empty-idle-v1'')';
 freshness text:='valid:=valid and latest>=date_trunc(''second'',incident);';
begin
 for item in select * from (values
  ('icash_research_private.guard_capacity_precision_followup()'),
  ('public.icash_claim_export_capacity_probe(uuid,text)'),
  ('public.icash_finish_automatic_export_capacity(uuid)')
 ) expected(signature) loop
  d:=pg_get_functiondef(item.signature::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then
   raise exception 'Empty export policy replacement changed: %',item.signature;
  end if;
  d:=replace(d,needle,replacement);
  if item.signature='public.icash_finish_automatic_export_capacity(uuid)' then
   if (length(d)-length(replace(d,freshness,'')))<>length(freshness) then raise exception 'Capacity inventory freshness changed';end if;
   -- A rejected empty request need not create an export history row. The three
   -- newly admitted, bounded authenticated inventory reads still prove idle
   -- capacity; they never establish the rejected operation's price or outcome.
   d:=replace(d,freshness,'valid:=valid and (r.auto_policy=''empty-idle-v1'' or latest>=date_trunc(''second'',incident));');
  end if;
  execute d;
  if pg_get_functiondef(item.signature::regprocedure)<>d then raise exception 'Empty export capacity verification failed';end if;
 end loop;
end $patch$;
revoke all on function icash_research_private.capacity_source_before_empty(uuid,text),
 icash_research_private.capacity_source_policy(uuid,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
