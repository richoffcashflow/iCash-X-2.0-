set local lock_timeout='2s';
set local statement_timeout='8s';
-- The account-first primary key covers account references, but not the
-- separate screening foreign key when its parent is updated or removed.
do $guard$
begin
 if not exists(select 1 from icash_seller_memory_private.settings where id=1 and not enabled and enabled_at is null and release_sha is null)
  or md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure))<>'f1316a0d62155d6f61426b7419e52cf2' then
  raise exception 'Seller memory screening index prerequisite changed';
 end if;
end $guard$;
create index seller_memory_snapshots_screening on icash_seller_memory_private.snapshots(screening_id);
