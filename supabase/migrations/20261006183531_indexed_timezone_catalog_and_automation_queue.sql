-- Cache names only. PostgreSQL still calculates every UTC offset and DST boundary.
-- Enumerating pg_timezone_names reopens all tzdata files on each call and was
-- taking ~650 ms even for an equality lookup on the production Nano instance.
create table public.icash_timezone_names (
 name text primary key
);
alter table public.icash_timezone_names enable row level security;
revoke all on public.icash_timezone_names from public,anon,authenticated;
grant select on public.icash_timezone_names to service_role;
comment on table public.icash_timezone_names is
 'Private timezone-name catalog. Refresh after a PostgreSQL/tzdata upgrade; offsets are never cached.';

insert into public.icash_timezone_names(name)
 select name from pg_catalog.pg_timezone_names;

-- Owned maintenance runs this after PostgreSQL/tzdata upgrades. Not an API RPC:
-- only the table/function owner can refresh the catalog, without new client grants.
create function public.icash_refresh_timezone_names() returns void
language plpgsql set search_path='' as $$
begin
 lock table public.icash_timezone_names in exclusive mode;
 delete from public.icash_timezone_names;
 insert into public.icash_timezone_names(name) select name from pg_catalog.pg_timezone_names;
end $$;
revoke all on function public.icash_refresh_timezone_names() from public,anon,authenticated,service_role;

-- Keep the currently installed function bodies, grants, security mode and all
-- eligibility conditions. Replace only the source of the valid-name lookup.
-- This includes older scheduler wrappers that remain in the live call chain.
do $$
declare f record;definition text;changed integer:=0;
begin
 for f in
  select p.oid,p.prosecdef from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname like 'icash_%'
   and p.proname<>'icash_refresh_timezone_names' and p.prosrc like '%pg_timezone_names%'
 loop
  if f.prosecdef or has_function_privilege('anon',f.oid,'execute')
    or has_function_privilege('authenticated',f.oid,'execute') then
   raise exception 'Timezone optimization requires private, invoker-only functions: %',f.oid::regprocedure;
  end if;
  definition:=pg_catalog.pg_get_functiondef(f.oid);
  definition:=replace(definition,'pg_catalog.pg_timezone_names','public.icash_timezone_names');
  definition:=regexp_replace(definition,'\mpg_timezone_names\M','public.icash_timezone_names','g');
  execute definition;
  changed:=changed+1;
 end loop;
 if changed=0 then raise exception 'No timezone lookups found to optimize';end if;
end $$;

-- These predicates run on each scheduler pass. Avoid scanning completed history.
create index icash_automation_kind_recent
 on public.icash_automation_tickets(kind,created_at desc);
create index icash_automation_expiring
 on public.icash_automation_tickets(expires_at) where state='issued';
create index icash_automation_opener_history
 on public.icash_automation_tickets(opener_message_id,created_at desc,id desc)
 where opener_message_id is not null;

analyze public.icash_timezone_names;
analyze public.icash_automation_tickets;
