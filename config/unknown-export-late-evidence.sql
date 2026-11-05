-- Keep a verified unknown-response capacity decision immutable while accepting
-- a later original receipt. Nonterminal late evidence restores the global fence
-- without clearing that decision or conflicting with a newer pending export.
begin;
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
