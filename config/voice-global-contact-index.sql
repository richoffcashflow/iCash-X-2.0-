-- The unchanged voice slot guard excludes busy/unknown calls globally by
-- contact identity. Account-leading indexes cannot answer that lookup cheaply.
-- Index only the existing voice branch; retain the DNC join and every guard.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if pg_catalog.to_regprocedure('icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)') is null
  or md5(pg_catalog.pg_get_functiondef('icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)'::regprocedure))
   <> '417d8f30a03ac180c804edff5ab55581' then
  raise exception 'Voice slot guard changed; review the global contact lookup before indexing';
 end if;
 if md5(pg_catalog.pg_get_viewdef('public.icash_voice_contact_targets'::regclass,true))
   <> '36c0048540d8f62f5decd81be63d404d' then
  raise exception 'Voice contact UNION changed; review both source branches before indexing';
 end if;
 -- Fail closed if another migration already supplied an equivalent leading
 -- key. Re-review its predicate/coverage rather than silently adding duplicates.
 if exists(select 1 from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid=i.indexrelid
  join pg_catalog.pg_am am on am.oid=c.relam
  where i.indrelid='public.icash_operational_contacts'::regclass
   and i.indisvalid and i.indisready and am.amname='btree'
   and pg_catalog.pg_get_indexdef(i.indexrelid,1,true)='contact_key'
   and (i.indpred is null or pg_catalog.pg_get_expr(i.indpred,i.indrelid)='(channel = ''voice''::text)')) then
  raise exception 'An equivalent global voice contact index already exists; review before adding another';
 end if;
end
$guard$;
create index icash_operational_voice_contact_key
 on public.icash_operational_contacts(contact_key) include(id,account_id,dnc_receipt_id)
 where channel='voice';
commit;
