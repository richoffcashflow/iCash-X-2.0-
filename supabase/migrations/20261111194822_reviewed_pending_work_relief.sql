-- Owner request, 2026-11-11: remove the historical planning holds and resume work.
-- Install inactive. An operator activates the frozen, bounded manifest only
-- after exact-release verification. Unknown operations and supplier reserves
-- remain unchanged; this is neither settlement nor a customer credit grant.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

do $$
declare item record;
begin
 for item in select * from (values
  ('public.icash_prospecting_total_available(uuid)','814cf7934f1d444996fc4a8211357ecc'),
  ('public.icash_daily_work_target(uuid)','587af3fc94cc82b586add5723d4c85d9'),
  ('public.icash_prospecting_progress(uuid)','56a51192f325ee08c2ca465c2720f08a')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Reviewed pending-work prerequisite changed: %',item.signature;
  end if;
 end loop;
end $$;

create schema if not exists icash_reliability_private;
create table icash_reliability_private.pending_work_relief (
 operation_key text primary key,
 account_id uuid not null,
 operation_snapshot jsonb not null,
 check(operation_snapshot->>'operation_key'=operation_key),
 check((operation_snapshot->>'account_id')::uuid=account_id)
);
create index pending_work_relief_account on icash_reliability_private.pending_work_relief(account_id);
create table icash_reliability_private.pending_work_relief_policy (
 id integer primary key check(id=1),
 captured_at timestamptz not null default now(),
 cutoff timestamptz not null check(cutoff='2026-11-11T00:00:00Z'::timestamptz),
 account_count integer not null check(account_count between 1 and 117),
 operation_count integer not null check(operation_count between 1 and 807),
 charge_cap_cents bigint not null check(charge_cap_cents between 1 and 150245),
 reserved_micros bigint not null check(reserved_micros between 0 and 800253880),
 manifest text not null check(manifest~'^[a-f0-9]{32}$'),
 authority text not null check(authority='Owner request 2026-11-11: remove the holds and get it to work'),
 enabled boolean not null default false,
 activated_at timestamptz,
 release_sha text check(release_sha~'^[a-f0-9]{40}$'),
 check((activated_at is null)=(release_sha is null)),
 check(not enabled or activated_at is not null)
);
alter table icash_reliability_private.pending_work_relief enable row level security;
alter table icash_reliability_private.pending_work_relief_policy enable row level security;
revoke all on icash_reliability_private.pending_work_relief,icash_reliability_private.pending_work_relief_policy from public,anon,authenticated,service_role;
grant usage on schema icash_reliability_private to service_role;
grant select on icash_reliability_private.pending_work_relief,icash_reliability_private.pending_work_relief_policy to service_role;
create policy pending_work_relief_service_read on icash_reliability_private.pending_work_relief for select to service_role using(true);
create policy pending_work_relief_policy_service_read on icash_reliability_private.pending_work_relief_policy for select to service_role using(true);

-- Freeze only the reviewed pre-November-11 backlog in accounts blocked by it.
-- No recurring age-out, no future cohort expansion, no operation-state updates.
insert into icash_reliability_private.pending_work_relief(operation_key,account_id,operation_snapshot)
select o.operation_key,o.account_id,to_jsonb(o)-'estimate_checked_at'
from public.icash_operation_spend o
join public.icash_account_work_observations() a on a.account_id=o.account_id and a.reason='pending_work'
where o.state in ('reserved','dispatched') and o.created_at<'2026-11-11T00:00:00Z'::timestamptz;
insert into icash_reliability_private.pending_work_relief_policy
 (id,cutoff,account_count,operation_count,charge_cap_cents,reserved_micros,manifest,authority)
select 1,'2026-11-11T00:00:00Z',count(distinct account_id),count(*),
 sum((operation_snapshot->>'charge_cap_cents')::bigint),sum((operation_snapshot->>'reserved_micros')::bigint),
 md5(string_agg(operation_key||operation_snapshot::text,E'\n' order by operation_key)),
 'Owner request 2026-11-11: remove the holds and get it to work'
from icash_reliability_private.pending_work_relief;

create function icash_reliability_private.pending_planning_cents(p_operation public.icash_operation_spend) returns bigint
language sql stable security invoker set search_path='' as $$
 select case when p_operation.state not in ('reserved','dispatched') then 0
  when exists(select 1 from icash_reliability_private.pending_work_relief r
   join icash_reliability_private.pending_work_relief_policy p on p.id=1 and p.enabled
   where r.operation_key=p_operation.operation_key and r.account_id=p_operation.account_id
    and r.operation_snapshot=to_jsonb(p_operation)-'estimate_checked_at') then 0
  else p_operation.charge_cap_cents end;
$$;
revoke all on function icash_reliability_private.pending_planning_cents(public.icash_operation_spend) from public,anon,authenticated;
grant execute on function icash_reliability_private.pending_planning_cents(public.icash_operation_spend) to service_role;

create or replace function public.icash_prospecting_total_available(p_account uuid) returns bigint
language sql stable set search_path='' as $$
 select coalesce((
  select greatest(0,w.balance_cents-coalesce((
   select sum(icash_reliability_private.pending_planning_cents(o)) from public.icash_operation_spend o
   where o.account_id=p_account and o.state in ('reserved','dispatched')
  ),0))::bigint
  from public.icash_wallets w where w.account_id=p_account
   and exists(select 1 from public.icash_prospecting_budgets b where b.account_id=p_account)
 ),0);
$$;

-- Keep the real unfinished quotes visible; only the planning deduction changes.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure);
 needle:='coalesce(sum(o.charge_cap_cents) filter(where o.state in (''reserved'',''dispatched'')),0)::bigint pending';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Daily pending commitment boundary changed';
 end if;
 definition:=replace(definition,needle,needle||',
   coalesce(sum(icash_reliability_private.pending_planning_cents(o)) filter(where o.state in (''reserved'',''dispatched'')),0)::bigint planning_pending');
 definition:=replace(definition,'''pendingCents'',u.pending,',
  '''pendingCents'',u.pending,''planningPendingCents'',u.planning_pending,''releasedPendingCents'',u.pending-u.planning_pending,');
 definition:=replace(definition,'t.cents-u.spent-u.pending','t.cents-u.spent-u.planning_pending');
 execute definition;
end $$;

-- Existing support answers describe pendingCents as funds set aside. Report
-- the actual planning commitment there, without changing any visible copy.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_prospecting_progress(uuid)'::regprocedure);
 needle:='sum(charge_cap_cents) filter(where state in (''reserved'',''dispatched''))';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Progress pending commitment boundary changed';
 end if;
 execute replace(definition,needle,'sum(icash_reliability_private.pending_planning_cents(icash_operation_spend)) filter(where state in (''reserved'',''dispatched''))');
end $$;

-- Operator-only: ordinary services can read the reviewed manifest, never enable
-- or expand it. The same global lock serializes activation with final admission.
create function icash_reliability_private.activate_pending_work_relief(p_manifest text,p_release_sha text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare policy icash_reliability_private.pending_work_relief_policy;observed text;
begin
 if p_manifest is null or p_manifest!~'^[a-f0-9]{32}$' or p_release_sha is null or p_release_sha!~'^[a-f0-9]{40}$' then
  raise exception 'Exact reviewed manifest and verified release required';
 end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict policy from icash_reliability_private.pending_work_relief_policy where id=1 for update;
 select md5(string_agg(operation_key||operation_snapshot::text,E'\n' order by operation_key)) into observed
 from icash_reliability_private.pending_work_relief;
 if observed is distinct from policy.manifest or p_manifest<>policy.manifest then
  raise exception 'Reviewed pending-work manifest changed';
 end if;
 if policy.activated_at is not null then
  if p_release_sha<>policy.release_sha then raise exception 'Relief already activated for another release';end if;
  return jsonb_build_object('activated',false,'enabled',policy.enabled,'activatedAt',policy.activated_at);
 end if;
 update icash_reliability_private.pending_work_relief_policy
 set enabled=true,activated_at=clock_timestamp(),release_sha=p_release_sha where id=1 returning * into policy;
 return jsonb_build_object('activated',true,'enabled',true,'activatedAt',policy.activated_at,
  'accounts',policy.account_count,'operations',policy.operation_count,'planningQuotesCents',policy.charge_cap_cents);
end $$;
revoke all on function icash_reliability_private.activate_pending_work_relief(text,text) from public,anon,authenticated,service_role;
commit;
