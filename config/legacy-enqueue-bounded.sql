-- Bound campaign preparation; final send authorization remains unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.icash_legacy_enqueue_cursors(
 launch_id uuid primary key references public.icash_legacy_launches(id),
 after_contact uuid, checked_at timestamptz not null default now()
);
alter table public.icash_legacy_enqueue_cursors enable row level security;
revoke all on public.icash_legacy_enqueue_cursors from public,anon,authenticated;
grant select,insert,update on public.icash_legacy_enqueue_cursors to service_role;
create index icash_legacy_contact_scan on public.icash_legacy_contacts(launch_id,id);
create index icash_legacy_email_global on public.icash_legacy_contacts(email) where email is not null;

-- Reuse the current receipt/suppression rules, but synchronize only this batch.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.icash_legacy_sync(uuid)'::regprocedure);
 if position('c.launch_id = p_launch' in definition)>0 then
  definition:=replace(definition,'c.launch_id = p_launch','c.launch_id=p_launch');
 end if;
 if position('c.launch_id=p_launch' in definition)=0 then raise exception 'Legacy sync prerequisite changed';end if;
 definition:=replace(definition,'icash_legacy_sync(p_launch uuid)','icash_legacy_sync_batch(p_launch uuid, p_contacts uuid[])');
 definition:=replace(definition,'c.launch_id=p_launch','c.launch_id=p_launch and c.id=any(p_contacts)');
 execute definition;
end $patch$;
revoke all on function public.icash_legacy_sync_batch(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.icash_legacy_sync_batch(uuid,uuid[]) to service_role;

create or replace function public.icash_legacy_enqueue() returns integer
language plpgsql security invoker set search_path='' as $$
declare l public.icash_legacy_launches;ids uuid[];cursor_id uuid;n integer:=0;added integer;
begin
 -- Overlapping workers yield instead of holding database connections.
 if not pg_try_advisory_xact_lock(726341929) then return 0;end if;
 for l in select * from public.icash_legacy_launches
  where state='active' and approved_revision=revision and history_reviewed_at is not null
  and approved_at is not null and started_at is not null order by id loop
  insert into public.icash_legacy_enqueue_cursors(launch_id) values(l.id) on conflict do nothing;
  select after_contact into cursor_id from public.icash_legacy_enqueue_cursors where launch_id=l.id;
  select array_agg(id order by id) into ids from (
   select id from public.icash_legacy_contacts where launch_id=l.id and (cursor_id is null or id>cursor_id)
   order by id limit 250
  ) batch;
  if ids is null then
   select array_agg(id order by id) into ids from (
    select id from public.icash_legacy_contacts where launch_id=l.id order by id limit 250
   ) batch;
  end if;
  if ids is null then continue;end if;
  perform public.icash_legacy_sync_batch(l.id,ids);
  -- Check expensive admission once per contact/channel, after excluding jobs
  -- already present. No repeated whole-list permission scan for every step.
  with candidates as materialized (
   select c.id contact_id,s->>'id' step_id,x.cycle,s->>'channel' channel,
    case when s->>'channel'='email' then c.email else c.phone end recipient,
    greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')
     +make_interval(days=>(s->>'day')::integer+x.cycle*coalesce((s->>'repeatDays')::integer,0),hours=>coalesce((s->>'hour')::integer,0)) due_at,
    coalesce(s->>'subject','') subject,s->>'body' body
   from public.icash_legacy_contacts c cross join jsonb_array_elements(l.steps) s
   cross join lateral (select case when coalesce((s->>'repeatDays')::integer,0)>0 then greatest(0,floor((extract(epoch from now()-greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days'))/86400-(s->>'day')::integer)/(s->>'repeatDays')::integer)::integer) else 0 end cycle) x
   where c.launch_id=l.id and c.id=any(ids) and c.suppressed_reason is null and c.stopped_at is null and c.replied_at is null and c.converted_at is null
  ), missing as materialized (
   select c.* from candidates c where c.due_at<=now() and c.recipient is not null
    and not exists(select 1 from public.icash_legacy_outbox o where o.launch_id=l.id and o.step_id=c.step_id
     and o.cycle=c.cycle and o.channel=c.channel and o.recipient=c.recipient)
  ), allowed as materialized (
   select contact_id,channel,public.icash_legacy_admit(contact_id,channel) admitted
   from (select distinct contact_id,channel from missing) pairs
  )
  insert into public.icash_legacy_outbox(launch_id,contact_id,step_id,cycle,channel,recipient,due_at,subject,body,revision)
  select l.id,m.contact_id,m.step_id,m.cycle,m.channel,m.recipient,m.due_at,m.subject,m.body,l.revision
  from missing m join allowed a using(contact_id,channel) where a.admitted
  on conflict(launch_id,step_id,cycle,channel,recipient) do nothing;
  get diagnostics added=row_count;n:=n+added;
  update public.icash_legacy_enqueue_cursors set after_contact=ids[array_length(ids,1)],checked_at=now() where launch_id=l.id;
 end loop;
 return n;
end $$;
revoke all on function public.icash_legacy_enqueue() from public,anon,authenticated;
grant execute on function public.icash_legacy_enqueue() to service_role;
commit;
