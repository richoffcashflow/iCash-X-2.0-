-- An ended local handler with an unknown provider result keeps all original
-- purchase/owner/money evidence. Three fresh FREE reads may release capacity.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $check$
declare item record;
begin
 for item in select * from (values
  ('icash_research_private.capacity_source_policy(uuid,text)','ccc33fdda21c34a8b52edad319e0de11'),
  ('icash_research_private.guard_capacity_precision_followup()','f6510216db7756ae14f9bf4d608479ed'),
  ('icash_research_private.guard_export_capacity_review()','8e269defc58895189416405c66ce2f49'),
  ('public.icash_claim_automatic_export_capacity(text)','2bdb89367de2251258a2b26323694182'),
  ('public.icash_claim_export_capacity_probe(uuid,text)','4f0b5d2c442218dfb259c7d91206c12f'),
  ('public.icash_finish_automatic_export_capacity(uuid)','488dbd38f57278660bcb3c2c7d1dc0ce')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Unknown export capacity prerequisite changed: %',item.signature;
  end if;
 end loop;
end $check$;
alter table icash_research_private.export_capacity_automation add column unknown_enabled boolean not null default false;
alter table icash_research_private.owner_export_capacity_reviews add column source_snapshot jsonb;
alter table icash_research_private.owner_export_capacity_reviews drop constraint owner_export_capacity_reviews_auto_policy_check;
alter table icash_research_private.owner_export_capacity_reviews add constraint owner_export_capacity_reviews_auto_policy_check
 check(auto_policy is null or auto_policy in ('idle-v1','gateway-idle-v1','empty-idle-v1','unknown-idle-v1'));
alter table icash_research_private.owner_export_capacity_reviews add constraint unknown_capacity_source_required
 check((auto_policy is not distinct from 'unknown-idle-v1' and source_snapshot is not null and jsonb_typeof(source_snapshot)='object' and receipt_hash=md5(source_snapshot::text))
  or (auto_policy is distinct from 'unknown-idle-v1' and source_snapshot is null));

create function icash_research_private.unknown_capacity_source_snapshot(p_export uuid) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;q icash_research_private.requests;handlers jsonb;
begin
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 select * into q from icash_research_private.requests where id=p_export;
 if e.id is null or b.id is null or q.id is null then return null;end if;
 select jsonb_agg(to_jsonb(t) order by t.id) into handlers from public.icash_automation_tickets t
 where t.account_id=b.account_id and t.screening_id=b.primary_screening and t.kind='contacts'
  and t.created_at<=b.created_at and t.expires_at>=b.created_at;
 if jsonb_array_length(handlers) is distinct from 1 then return null;end if;
 return jsonb_build_object('policy','unknown-idle-v1','export',to_jsonb(e)-'capacity_review_id',
  'batch',to_jsonb(b),'request',to_jsonb(q),'handler',handlers->0);
end $fn$;
create function icash_research_private.capacity_source_fingerprint(p_export uuid) returns text
language sql stable set search_path='' as $fn$
 select case when e.receipt is not null then md5(e.receipt::text)
 else md5(icash_research_private.unknown_capacity_source_snapshot(e.id)::text) end
 from icash_research_private.owner_exports e where id=p_export;
$fn$;
alter function icash_research_private.capacity_source_policy(uuid,text) rename to capacity_source_before_unknown;
create function icash_research_private.capacity_source_policy(p_export uuid,p_hash text) returns text
language plpgsql stable set search_path='' as $fn$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;q icash_research_private.requests;source jsonb;h jsonb;prior text;
begin
 prior:=icash_research_private.capacity_source_before_unknown(p_export,p_hash);
 if prior is not null then return prior;end if;
 if not exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled and unknown_enabled) then return null;end if;
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 select * into q from icash_research_private.requests where id=p_export;
 source:=icash_research_private.unknown_capacity_source_snapshot(p_export);h:=source->'handler';
 if (e.id is not null and b.id is not null and q.id is not null and source is not null
  and p_hash is not null and p_hash=md5(source::text)
  and e.receipt is null and e.terminal_at is null and e.completed_at is null and e.capacity_review_id is null
  and e.recovery is null and e.csv is null and (e.lease_until is null or e.lease_until<=now())
  and b.state='claimed' and b.paid_receipt is null and b.results is null
  and q.account_id=b.account_id and q.kind='owner_lookup' and q.operation_key='owner-batch:'||e.id
  and q.admitted and q.result='{"outcome":"unknown"}'::jsonb
  and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
  and h->>'state'='held' and h->>'outcome'='held_for_reconciliation' and h->'issue_attempts'='1'::jsonb
  and (h->>'completed_at')::timestamptz>=q.finished_at
  and (h->>'completed_at')::timestamptz<=now()-interval '5 minutes'
  and (h->>'expires_at')::timestamptz<=now()-interval '5 minutes'
  and jsonb_typeof(e.request->'people_ids')='array' and jsonb_array_length(e.request->'people_ids') between 1 and 125
  and not exists(select 1 from jsonb_array_elements(e.request->'people_ids') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 128)
  and not exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null)) is true
 then return 'unknown-idle-v1';end if;
 return null;
exception when others then return null;
end $fn$;

-- Original provider Date is required; reject malformed, cached, stale or future
-- responses. SQL never substitutes a local timestamp for missing provider data.
create function icash_research_private.capacity_probe_response_fresh(p_receipt jsonb,p_started timestamptz,p_received timestamptz) returns boolean
language plpgsql immutable set search_path='' as $fn$
declare d text:=p_receipt#>>'{headers,date}';age jsonb:=p_receipt#>'{headers,age}';stamp timestamptz;
begin
 if d is null or d !~ '^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$'
  or jsonb_typeof(p_receipt#>'{headers,date}') is distinct from 'string'
  or age is null or (age is distinct from 'null'::jsonb and age is distinct from '"0"'::jsonb)
  or p_started is null or p_received is null then return false;end if;
 stamp:=d::timestamptz;
 return stamp>=date_trunc('second',p_started)-interval '5 seconds'
  and stamp<=p_received+interval '5 seconds' and p_received>=p_started;
exception when others then return false;
end $fn$;

do $patch$
declare item record;d text;needle text:='(''idle-v1'',''gateway-idle-v1'',''empty-idle-v1'')';
 replacement text:='(''idle-v1'',''gateway-idle-v1'',''empty-idle-v1'',''unknown-idle-v1'')';
begin
 d:=pg_get_functiondef('icash_research_private.guard_export_capacity_review()'::regprocedure);
 if (length(d)-length(replace(d,'if tg_op=''DELETE'' or','')))<>length('if tg_op=''DELETE'' or') then raise exception 'Unknown source immutability replacement changed';end if;
 d:=replace(d,'if tg_op=''DELETE'' or','if tg_op=''DELETE'' or old.source_snapshot is distinct from new.source_snapshot or');execute d;
 for item in select * from (values
  ('icash_research_private.guard_capacity_precision_followup()'),
  ('public.icash_claim_export_capacity_probe(uuid,text)'),
  ('public.icash_finish_automatic_export_capacity(uuid)')
 ) expected(signature) loop
  d:=pg_get_functiondef(item.signature::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Unknown capacity family replacement changed: %',item.signature;end if;
  d:=replace(d,needle,replacement);
  if item.signature='public.icash_finish_automatic_export_capacity(uuid)' then
   -- Match receipt writer's export-before-batch order. Keep every bound source
   -- row stable through final source verification and the capacity link write.
   if (length(d)-length(replace(d,'select jsonb_object_agg(probe,','')))<>length('select jsonb_object_agg(probe,') then raise exception 'Unknown source locking replacement changed';end if;
   d:=replace(d,'select jsonb_object_agg(probe,',$locks$
 if r.auto_policy='unknown-idle-v1' then
  perform 1 from icash_research_private.owner_exports where id=r.export_id for update;
  perform 1 from icash_research_private.owner_batches where id=r.export_id for update;
  perform 1 from icash_research_private.requests where id=r.export_id for update;
  perform 1 from public.icash_automation_tickets where id=(r.source_snapshot#>>'{handler,id}')::uuid for update;
 end if;
 select jsonb_object_agg(probe,$locks$);
   if (length(d)-length(replace(d,'raw:=p.receipt->''raw'';','')))<>length('raw:=p.receipt->''raw'';') then raise exception 'Unknown response freshness replacement changed';end if;
   d:=replace(d,'raw:=p.receipt->''raw'';','raw:=p.receipt->''raw'';'||$fresh$
   if r.auto_policy='unknown-idle-v1' and icash_research_private.capacity_probe_response_fresh(p.receipt,p.started_at,p.received_at) is distinct from true then valid:=false;exit;end if;
$fresh$);
   if (length(d)-length(replace(d,'r.auto_policy=''empty-idle-v1'' or latest>=','')))<>length('r.auto_policy=''empty-idle-v1'' or latest>=') then raise exception 'Unknown inventory freshness replacement changed';end if;
   d:=replace(d,'r.auto_policy=''empty-idle-v1'' or latest>=','r.auto_policy in (''empty-idle-v1'',''unknown-idle-v1'') or latest>=');
  end if;
  execute d;
  if pg_get_functiondef(item.signature::regprocedure)<>d then raise exception 'Unknown capacity replacement verification failed';end if;
 end loop;
 d:=pg_get_functiondef('public.icash_claim_automatic_export_capacity(text)'::regprocedure);
 if (length(d)-length(replace(d,'md5(e.receipt::text)','')))<>4*length('md5(e.receipt::text)') then raise exception 'Unknown capacity fingerprint sites changed';end if;
 d:=replace(d,'md5(e.receipt::text)','icash_research_private.capacity_source_fingerprint(e.id)');
 if (length(d)-length(replace(d,'auto_policy,auto_attempt,supersedes)','')))<>length('auto_policy,auto_attempt,supersedes)')
  or (length(d)-length(replace(d,'coalesce(previous.auto_attempt,0)+1,previous.id)','')))<>length('coalesce(previous.auto_attempt,0)+1,previous.id)') then raise exception 'Unknown source insertion replacement changed';end if;
 d:=replace(d,'auto_policy,auto_attempt,supersedes)','auto_policy,auto_attempt,supersedes,source_snapshot)');
 d:=replace(d,'coalesce(previous.auto_attempt,0)+1,previous.id)','coalesce(previous.auto_attempt,0)+1,previous.id,case when source_policy=''unknown-idle-v1'' then icash_research_private.unknown_capacity_source_snapshot(e.id) end)');
 execute d;
 if pg_get_functiondef('public.icash_claim_automatic_export_capacity(text)'::regprocedure)<>d then raise exception 'Unknown capacity claim verification failed';end if;
end $patch$;
revoke all on function icash_research_private.unknown_capacity_source_snapshot(uuid),
 icash_research_private.capacity_source_fingerprint(uuid),icash_research_private.capacity_source_before_unknown(uuid,text),
 icash_research_private.capacity_source_policy(uuid,text),icash_research_private.capacity_probe_response_fresh(jsonb,timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
-- Keep a verified unknown-response capacity decision immutable while accepting
-- a later original receipt. Nonterminal late evidence restores the global fence
-- without clearing that decision or conflicting with a newer pending export.
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $check$
declare item record;
begin
 for item in select * from (values
  ('icash_research_private.guard_export_capacity_binding()','15ac6c460e104757a537fb8e9df4ee15'),
  ('public.icash_owner_active_export_capacity()','8ea19b4d6de0fca19265db1d4663f843'),
  ('public.icash_owner_active_export_capacity(uuid)','50688a5063267a38f9c3b311f1c12a64'),
  ('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)','ad2d3c6638ef8c926f8736c634efd16e'),
  ('public.icash_record_owner_export_receipt(uuid,uuid,jsonb)','f99f1cb41b5b95fa8dc83916a8d7b291'),
  ('public.icash_record_owner_batch_receipt(uuid,uuid,jsonb)','8802f030be3a9f50c54a0f9daa7f7bf4'),
  ('public.icash_owner_export_findings()','e7cd0228e077575d7f2d9191fb637946')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Late export evidence prerequisite changed: %',item.signature;
  end if;
 end loop;
 if not exists(select 1 from information_schema.columns where table_schema='icash_research_private'
  and table_name='owner_export_capacity_reviews' and column_name='source_snapshot')
  or to_regprocedure('icash_research_private.unknown_capacity_source_snapshot(uuid)') is null then
  raise exception 'Unknown export source snapshot prerequisite required';
 end if;
end $check$;

create table icash_research_private.unknown_export_late_holds(
 export_id uuid primary key references icash_research_private.owner_exports(id),
 review_id uuid not null unique references icash_research_private.owner_export_capacity_reviews(id),
 evidence jsonb not null,
 observed_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.unknown_export_late_holds enable row level security;
revoke all on icash_research_private.unknown_export_late_holds from public,anon,authenticated,service_role;
create function icash_research_private.guard_unknown_export_late_hold() returns trigger
language plpgsql set search_path='' as $fn$
begin
 raise exception 'Late original export evidence is immutable';
end $fn$;
create trigger unknown_export_late_hold_immutable before update or delete
 on icash_research_private.unknown_export_late_holds for each row
 execute function icash_research_private.guard_unknown_export_late_hold();

create function icash_research_private.unknown_export_late_capacity_blocked() returns boolean
language sql stable set search_path='' as $fn$
 select exists(select 1 from icash_research_private.unknown_export_late_holds h
  join icash_research_private.owner_exports e on e.id=h.export_id
  where e.terminal_at is null);
$fn$;

create or replace function icash_research_private.guard_export_capacity_binding() returns trigger
language plpgsql set search_path='' as $fn$
declare r icash_research_private.owner_export_capacity_reviews;current_snapshot jsonb;
begin
 if old.capacity_review_id is not null and old.capacity_review_id is distinct from new.capacity_review_id then
  raise exception 'Export capacity binding is immutable';
 end if;
 if new.capacity_review_id is not null then
  select * into r from icash_research_private.owner_export_capacity_reviews
   where id=new.capacity_review_id and export_id=new.id and state='verified';
  if not found then raise exception 'Verified export capacity evidence required';end if;
  if r.auto_policy='unknown-idle-v1' then
   if r.source_snapshot is null or r.receipt_hash is distinct from md5(r.source_snapshot::text) then
    raise exception 'Original unknown export source required';
   end if;
   if old.capacity_review_id is null then
    current_snapshot:=icash_research_private.unknown_capacity_source_snapshot(new.id);
    if new.receipt is not null or current_snapshot is null or r.source_snapshot is distinct from current_snapshot then
     raise exception 'Current unknown export source required';
    end if;
   elsif old.receipt is null and new.receipt is not null and new.terminal_at is null then
    -- A new export may already occupy the unique pending index. Retain both
    -- immutable records and re-block admission separately instead of clearing
    -- the original review or rejecting the late receipt.
    insert into icash_research_private.unknown_export_late_holds(export_id,review_id,evidence)
     values(new.id,r.id,jsonb_build_object('kind','export_receipt','receipt',new.receipt))
     on conflict(export_id) do nothing;
   end if;
  elsif r.receipt_hash is distinct from md5(new.receipt::text) then
   raise exception 'Verified export capacity evidence required';
  end if;
 end if;
 return new;
end $fn$;

-- The separately callable original batch recorder can also supply late paid
-- evidence. Its original immutable receipt is the source of this extra fence.
create function icash_research_private.observe_unknown_export_late_batch() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if old.paid_receipt is null and new.paid_receipt is not null then
  insert into icash_research_private.unknown_export_late_holds(export_id,review_id,evidence)
  select e.id,r.id,jsonb_build_object('kind','batch_receipt','receipt',new.paid_receipt)
  from icash_research_private.owner_exports e
  join icash_research_private.owner_export_capacity_reviews r on r.id=e.capacity_review_id and r.export_id=e.id
  where e.id=new.id and e.terminal_at is null and r.state='verified' and r.auto_policy='unknown-idle-v1'
  on conflict(export_id) do nothing;
 end if;
 return new;
end $fn$;
create trigger unknown_export_late_batch_evidence after update of paid_receipt
 on icash_research_private.owner_batches for each row
 execute function icash_research_private.observe_unknown_export_late_batch();

do $patch$
declare item text;d text;patched text;needle text;
begin
 -- Preserve each complete production function, including account-specific
 -- quota reserve, targeting, source proof and final financial admission.
 foreach item in array array[
  'public.icash_owner_active_export_capacity()',
  'public.icash_owner_active_export_capacity(uuid)',
  'public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'
 ] loop
  d:=pg_get_functiondef(item::regprocedure);
  needle:='exists(select 1 from icash_research_private.owner_exports where terminal_at is null and capacity_review_id is null)';
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Late capacity predicate changed: %',item;end if;
  patched:=replace(d,needle,'('||needle||' or icash_research_private.unknown_export_late_capacity_blocked())');
  execute patched;
  if pg_get_functiondef(item::regprocedure)<>patched then raise exception 'Late capacity patch verification failed';end if;
 end loop;
 -- Receipt writes and admission/finalization share organization -> export lock
 -- order. A receipt observed first therefore blocks subsequent new admission.
 item:='public.icash_record_owner_export_receipt(uuid,uuid,jsonb)';
 d:=pg_get_functiondef(item::regprocedure);needle:=E'begin\n select x.* into e';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Original receipt lock order changed';end if;
 patched:=replace(d,needle,E'begin\n perform pg_advisory_xact_lock(hashtextextended(''dealmachine:organization:owner-export'',0));\n select x.* into e');
 execute patched;
 if pg_get_functiondef(item::regprocedure)<>patched then raise exception 'Receipt lock order verification failed';end if;
 item:='public.icash_record_owner_batch_receipt(uuid,uuid,jsonb)';
 d:=pg_get_functiondef(item::regprocedure);needle:=E'begin\n select * into b';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Original batch receipt lock order changed';end if;
 patched:=replace(d,needle,E'begin\n perform pg_advisory_xact_lock(hashtextextended(''dealmachine:organization:owner-export'',0));\n select * into b');
 execute patched;
 if pg_get_functiondef(item::regprocedure)<>patched then raise exception 'Batch receipt lock order verification failed';end if;
 item:='public.icash_owner_export_findings()';
 d:=pg_get_functiondef(item::regprocedure);
 needle:='e.terminal_at is null and e.capacity_review_id is null';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Original export monitor changed';end if;
 patched:=replace(d,needle,'e.terminal_at is null and (e.capacity_review_id is null or exists(select 1 from icash_research_private.unknown_export_late_holds h where h.export_id=e.id))');
 execute patched;
 if pg_get_functiondef(item::regprocedure)<>patched then raise exception 'Late export monitor verification failed';end if;
end $patch$;

revoke all on function icash_research_private.guard_unknown_export_late_hold(),
 icash_research_private.observe_unknown_export_late_batch(),
 icash_research_private.unknown_export_late_capacity_blocked(),
 icash_research_private.guard_export_capacity_binding() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
