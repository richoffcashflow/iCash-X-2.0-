-- Correct only the empty November 16 review's owner source checker/locks.
-- A completed, source-bound free preview is not another paid owner purchase.
-- The migration runner owns the transaction and its ordered ledger insertion.
set local statement_timeout='8s';
set local lock_timeout='500ms';
set local idle_in_transaction_session_timeout='8s';
set local search_path='';
set local timezone='UTC';
select 1 from public.icash_operating_budget where id=1 for update nowait;
select 1 from public.icash_dealmachine_request_budget where id=1 for update nowait;
lock table icash_reliability_private.pending_work_relief_20261116,
 icash_reliability_private.pending_work_relief_policy_20261116,
 icash_reliability_private.pending_work_relief_activation_20261116 in access exclusive mode nowait;

do $patch$
declare r record;d text;needle text;replacement text;catalog_before jsonb;policies_before jsonb;
 targets oid[]:=array[
  'icash_reliability_private.pending_work_relief_idle_source_20261116(public.icash_operation_spend)'::regprocedure::oid,
  'icash_reliability_private.pending_work_relief_lock_source_20261116(public.icash_operation_spend)'::regprocedure::oid];
begin
 if not exists(select 1 from public.icash_operating_budget where id=1)
  or not exists(select 1 from public.icash_dealmachine_request_budget where id=1)
  or exists(select 1 from icash_reliability_private.pending_work_relief_20261116)
  or exists(select 1 from icash_reliability_private.pending_work_relief_policy_20261116)
  or exists(select 1 from icash_reliability_private.pending_work_relief_activation_20261116) then
  raise exception 'Owner preview correction requires the original empty inactive lifecycle';
 end if;
 -- Exact-key admitted lookups stay bounded without a cross-account table scan.
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('icash_research_private.research_requests_operation_started')
  and i.indrelid='icash_research_private.requests'::regclass and i.indisvalid and i.indisready
  and pg_get_indexdef(i.indexrelid)='CREATE INDEX research_requests_operation_started ON icash_research_private.requests USING btree (operation_key, created_at) WHERE admitted') then
  raise exception 'Owner preview exact-source lookup index changed';
 end if;
 for r in select * from (values
  ('icash_reliability_private.activate_pending_work_relief_20261116(text,text)','f8617a01efafb4b37529dd23e84256ca'),
  ('icash_reliability_private.pending_planning_cents(public.icash_operation_spend)','11e1c8ad46194fc624712477d54c6733'),
  ('icash_reliability_private.pending_work_relief_controls_20261116(uuid)','79554cdd97d5bb3100db543543c516c7'),
  ('icash_reliability_private.pending_work_relief_idle_source_20261116(public.icash_operation_spend)','fc9ed2c6a70a5322b79fc618fb1735e2'),
  ('icash_reliability_private.pending_work_relief_lock_source_20261116(public.icash_operation_spend)','ef7377949b781a568d6f522fd2e85b51'),
  ('icash_reliability_private.relief_activation_guard_20261116()','a79fd813f02639876a2d1f7db0a361df'),
  ('icash_reliability_private.relief_activation_manifest_20261116()','9851b8cbb8678f95d0063a685f583099'),
  ('icash_reliability_private.relief_hash_20261116(jsonb)','80f6a7a8b4eeba45e41549d42fdef97e'),
  ('icash_reliability_private.relief_manifest_20261116()','2e26a480ae55ef448b999d42befbde7a'),
  ('icash_reliability_private.relief_policy_guard_20261116()','43c5c9f4e767fd941671a3d20dbfe7ea'),
  ('icash_reliability_private.relief_pool_sha_20261116()','92566a430c26ebeece94af381e9df437'),
  ('icash_reliability_private.relief_rows_guard_20261116()','b718d0be9ca5c2c2be8bef1808bd25f4'),
  ('icash_reliability_private.rollback_pending_work_relief_20261116(text,text)','222bd849bd9fb6c03bf4d493816e204b'),
  ('icash_reliability_private.stage_pending_work_relief_20261116(jsonb,jsonb,text)','7ed417bfe2a6c3faf06b3af7ac761680'),
  ('public.icash_finish_credit(uuid,text,bigint,text)','84b289a8db3f75f90c16cd0266fb1395'),
  ('public.icash_prospecting_available(uuid)','9b8658ca38e513d6c6a37b282673e1b6'),
  ('public.icash_prospecting_total_available(uuid)','46ce810caee1fff9c57941196155163c'),
  ('public.icash_settle_operation(text,bigint,bigint,text)','c2eb9850afe01778577ccfce5838f33b')
 ) expected(signature,definition_md5) loop
  if md5(pg_get_functiondef(to_regprocedure(r.signature))) is distinct from r.definition_md5 then
   raise exception 'Owner preview correction predecessor changed: %',r.signature;
  end if;
 end loop;
 select jsonb_object_agg(p.oid::text,to_jsonb(p)) into catalog_before from pg_proc p
 where p.oid in (select to_regprocedure(x.signature) from (values
  ('icash_reliability_private.activate_pending_work_relief_20261116(text,text)'),
  ('icash_reliability_private.pending_planning_cents(public.icash_operation_spend)'),
  ('icash_reliability_private.pending_work_relief_controls_20261116(uuid)'),
  ('icash_reliability_private.pending_work_relief_idle_source_20261116(public.icash_operation_spend)'),
  ('icash_reliability_private.pending_work_relief_lock_source_20261116(public.icash_operation_spend)'),
  ('icash_reliability_private.relief_activation_guard_20261116()'),
  ('icash_reliability_private.relief_activation_manifest_20261116()'),
  ('icash_reliability_private.relief_hash_20261116(jsonb)'),
  ('icash_reliability_private.relief_manifest_20261116()'),
  ('icash_reliability_private.relief_policy_guard_20261116()'),
  ('icash_reliability_private.relief_pool_sha_20261116()'),
  ('icash_reliability_private.relief_rows_guard_20261116()'),
  ('icash_reliability_private.rollback_pending_work_relief_20261116(text,text)'),
  ('icash_reliability_private.stage_pending_work_relief_20261116(jsonb,jsonb,text)'),
  ('public.icash_finish_credit(uuid,text,bigint,text)'),
  ('public.icash_prospecting_available(uuid)'),
  ('public.icash_prospecting_total_available(uuid)'),
  ('public.icash_settle_operation(text,bigint,bigint,text)')
 ) x(signature));
 for r in select p.* from pg_proc p where p.oid=any(targets) loop
  if pg_get_userbyid(r.proowner) is distinct from 'postgres' or r.prosecdef
   or r.provolatile::text is distinct from 'v' or r.proconfig is distinct from array['search_path=""']::text[]
   or exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
    where a.grantee<>r.proowner or a.privilege_type<>'EXECUTE') then
   raise exception 'Owner preview correction source access changed';
  end if;
 end loop;
 perform 1 from icash_reliability_private.pending_work_relief_policy where id=1 for share nowait;
 perform 1 from icash_reliability_private.pending_work_relief_policy_20261113 where id=1 for share nowait;
 select jsonb_build_object('nov11',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy p where id=1),
  'nov13',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy_20261113 p where id=1),
  'operating',(select to_jsonb(p) from public.icash_operating_budget p where id=1),
  'requests',(select to_jsonb(p) from public.icash_dealmachine_request_budget p where id=1)) into policies_before;

 d:=pg_get_functiondef(targets[1]);
 needle:=$old$   or exists(select 1 from icash_research_private.requests x where x.account_id=o.account_id and x.operation_key='owner-batch:'||b.id and x.id<>b.id and x.admitted)$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preview duplicate guard changed';end if;
 d:=replace(d,needle,'');
 needle:=$old$  select * into e from icash_research_private.owner_exports where id=b.id;$old$;
 replacement:=$new$  -- Preserve legacy zero-preview originals. One normal completed preview is
  -- allowed only before the paid attempt; every other admitted request refuses.
  -- Include the full row (including its ID/result) in the frozen source proof.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into parts
   from icash_research_private.requests x
   where x.admitted and x.operation_key='owner-batch:'||b.id and x.id<>b.id;
  if jsonb_array_length(parts)>1 or exists(select 1 from icash_research_private.requests x
   where x.admitted and x.operation_key='owner-batch:'||b.id and x.id<>b.id
    and (x.account_id is distinct from o.account_id or x.kind is distinct from 'owner_preview'
     or x.created_at is null or x.finished_at is null or not isfinite(x.created_at) or not isfinite(x.finished_at)
     or q.created_at is null or not isfinite(q.created_at)
     or x.finished_at<x.created_at or x.finished_at>=q.created_at or x.finished_at>stamp-interval '10 minutes'
     or x.result->>'outcome' is distinct from 'response'
     or x.result->'httpStatus' is distinct from '200'::jsonb
     or x.result->'creditsUsed' is distinct from '0'::jsonb)) then return null;end if;
  select * into e from icash_research_private.owner_exports where id=b.id;$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preview source insertion point changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$'item',to_jsonb(bi),'originalRequest',to_jsonb(q),'export',to_jsonb(e)-array[$old$;
 replacement:=$new$'item',to_jsonb(bi),'originalRequest',to_jsonb(q),'previewRequests',parts,'export',to_jsonb(e)-array[$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preview fingerprint source changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef(targets[2]);
 needle:=$old$  perform 1 from icash_research_private.requests where id=batch or (account_id=p_operation.account_id and operation_key='owner-batch:'||batch) order by id for update nowait;$old$;
 replacement:=needle||$new$
  -- Retain original same-account locks and fence an admitted same-key row
  -- even if its account binding changed. Canonical inserts also require the
  -- request-budget row already held by stage/activation before this helper.
  perform 1 from icash_research_private.requests
   where admitted and operation_key='owner-batch:'||batch order by id for update nowait;$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preview source lock changed';end if;
 execute replace(d,needle,replacement);
 -- CREATE OR REPLACE must preserve all metadata/ACLs and every other body.
 for r in select p.* from pg_proc p where catalog_before ? p.oid::text loop
  if (case when r.oid=any(targets) then to_jsonb(r)-'prosrc' else to_jsonb(r) end)
   is distinct from (case when r.oid=any(targets) then (catalog_before->r.oid::text)-'prosrc' else catalog_before->r.oid::text end) then
   raise exception 'Owner preview correction changed unrelated function metadata';
  end if;
 end loop;
 if policies_before is distinct from jsonb_build_object(
  'nov11',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy p where id=1),
  'nov13',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy_20261113 p where id=1),
  'operating',(select to_jsonb(p) from public.icash_operating_budget p where id=1),
  'requests',(select to_jsonb(p) from public.icash_dealmachine_request_budget p where id=1)) then
  raise exception 'Owner preview correction changed financial policies';
 end if;
end $patch$;
