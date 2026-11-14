-- A definite quota wait preserves queue age just like a busy export slot.
-- Selection metadata only; original request limits, source and spend admission remain authoritative.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(726341927);
do $$
declare source text:=pg_get_functiondef('icash_work_private.record_export_wait(uuid,timestamptz)'::regprocedure);
begin
 if md5(source)<>'369340f7afd912f9e22149a1dd4a3655' then raise exception 'Export wait prerequisite changed';end if;
 execute replace(source,
  'public.icash_owner_active_export_capacity(p_account) is distinct from ''export_busy''',
  'coalesce(public.icash_owner_active_export_capacity(p_account),''unavailable'') not in (''export_busy'',''quota_wait'')');
end $$;
commit;
