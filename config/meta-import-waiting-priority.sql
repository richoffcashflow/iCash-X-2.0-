begin;
set local lock_timeout='3s';

-- Owner-selected export batches may serve the longest-waiting eligible client
-- first. Exact source/lead IDs keep ordinary live-form allocation unchanged.
create table public.icash_meta_import_priorities (
 source_id uuid not null references public.icash_meta_lead_sources(id),
 meta_id text not null check(meta_id ~ '^[0-9]{6,64}$'),
 batch_ref text not null check(length(batch_ref) between 8 and 200),
 created_at timestamptz not null default now(),
 primary key(source_id,meta_id)
);
alter table public.icash_meta_import_priorities enable row level security;
revoke all on public.icash_meta_import_priorities from public,anon,authenticated;
grant select,insert on public.icash_meta_import_priorities to service_role;

do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_meta_assign_contact(uuid)'::regprocedure);
 needle:='a record;screen uuid;';
 if position(needle in def)=0 then raise exception 'Meta assignment declaration changed';end if;
 def:=replace(def,needle,needle||'waiting_priority boolean;');
 needle:=' select ac.id,i.principal,w.balance_cents into a';
 if position(needle in def)=0 then raise exception 'Meta assignment selection changed';end if;
 def:=replace(def,needle,' select exists(select 1 from public.icash_meta_import_priorities p where p.source_id=m.source_id and p.meta_id=m.meta_id) into waiting_priority;'||chr(10)||needle);
 needle:=' order by public.icash_vip_active(ac.id) desc,';
 if position(needle in def)=0 then raise exception 'Meta assignment ordering changed';end if;
 def:=replace(def,needle,$order$
 order by case when waiting_priority then coalesce(greatest(
  (select max(x.assigned_at) from public.icash_seller_matches x where x.account_id=ac.id),
  (select max(x.routed_at) from public.icash_meta_leads x where x.account_id=ac.id)
 ),ac.created_at) end asc,
 public.icash_vip_active(ac.id) desc,
$order$);
 execute def;
end $patch$;
commit;
