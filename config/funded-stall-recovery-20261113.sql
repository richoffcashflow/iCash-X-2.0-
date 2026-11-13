-- Owner request, 2026-11-13: restore the reviewed stalled funded accounts.
-- Install inactive. An operator activates the frozen, bounded manifest only
-- after exact-release verification. Unknown operations and supplier reserves
-- remain unchanged; this is neither settlement nor a customer credit grant.
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

do $$ begin
 if md5(pg_get_functiondef('icash_reliability_private.pending_planning_cents(public.icash_operation_spend)'::regprocedure))<>'e805fb4d00d5a9da80cc8061ffd05292'
  or md5(pg_get_functiondef('public.icash_prospecting_total_available(uuid)'::regprocedure))<>'46ce810caee1fff9c57941196155163c'
  or not exists(select 1 from icash_reliability_private.pending_work_relief_policy where id=1 and enabled and activated_at is not null)
 then raise exception 'Funded recovery prerequisite changed';end if;
end $$;

create schema if not exists icash_reliability_private;
create table icash_reliability_private.pending_work_relief_20261113 (
 operation_key text primary key,
 account_id uuid not null,
 operation_snapshot jsonb not null,
 check(operation_snapshot->>'operation_key'=operation_key),
 check((operation_snapshot->>'account_id')::uuid=account_id)
);
create index pending_work_relief_20261113_account on icash_reliability_private.pending_work_relief_20261113(account_id);
create table icash_reliability_private.pending_work_relief_policy_20261113 (
 id integer primary key check(id=1),
 captured_at timestamptz not null default now(),
 cutoff timestamptz not null check(cutoff='2026-11-13T12:58:00Z'::timestamptz),
 account_count integer not null check(account_count between 1 and 80),
 operation_count integer not null check(operation_count between 1 and 293),
 charge_cap_cents bigint not null check(charge_cap_cents between 1 and 48842),
 reserved_micros bigint not null check(reserved_micros between 0 and 233494200),
 manifest text not null check(manifest~'^[a-f0-9]{32}$'),
 authority text not null check(authority='Owner request 2026-11-13: fix stalled and delayed accounts'),
 enabled boolean not null default false,
 activated_at timestamptz,
 release_sha text check(release_sha~'^[a-f0-9]{40}$'),
 check((activated_at is null)=(release_sha is null)),
 check(not enabled or activated_at is not null)
);
alter table icash_reliability_private.pending_work_relief_20261113 enable row level security;
alter table icash_reliability_private.pending_work_relief_policy_20261113 enable row level security;
revoke all on icash_reliability_private.pending_work_relief_20261113,icash_reliability_private.pending_work_relief_policy_20261113 from public,anon,authenticated,service_role;
grant usage on schema icash_reliability_private to service_role;
grant select on icash_reliability_private.pending_work_relief_20261113,icash_reliability_private.pending_work_relief_policy_20261113 to service_role;
create policy pending_work_relief_20261113_service_read on icash_reliability_private.pending_work_relief_20261113 for select to service_role using(true);
create policy pending_work_relief_policy_20261113_service_read on icash_reliability_private.pending_work_relief_policy_20261113 for select to service_role using(true);

-- Freeze only unrelieved operations older than the fixed investigation cutoff.
-- No recurring age-out, no future cohort expansion, no operation-state updates.
insert into icash_reliability_private.pending_work_relief_20261113(operation_key,account_id,operation_snapshot)
select o.operation_key,o.account_id,to_jsonb(o)-'estimate_checked_at'
from public.icash_operation_spend o
join public.icash_account_work_observations() a on a.account_id=o.account_id and a.reason='pending_work'
where o.state in ('reserved','dispatched') and o.created_at<'2026-11-13T12:58:00Z'::timestamptz
 and icash_reliability_private.pending_planning_cents(o)>0;
insert into icash_reliability_private.pending_work_relief_policy_20261113
 (id,cutoff,account_count,operation_count,charge_cap_cents,reserved_micros,manifest,authority)
select 1,'2026-11-13T12:58:00Z',count(distinct account_id),count(*),
 sum((operation_snapshot->>'charge_cap_cents')::bigint),sum((operation_snapshot->>'reserved_micros')::bigint),
 md5(string_agg(operation_key||operation_snapshot::text,E'\n' order by operation_key)),
 'Owner request 2026-11-13: fix stalled and delayed accounts'
from icash_reliability_private.pending_work_relief_20261113;

create or replace function icash_reliability_private.pending_planning_cents(p_operation public.icash_operation_spend) returns bigint
language sql stable security invoker set search_path='' as $$
 select case when p_operation.state not in ('reserved','dispatched') then 0
  when exists(select 1 from icash_reliability_private.pending_work_relief r
   join icash_reliability_private.pending_work_relief_policy p on p.id=1 and p.enabled
   where r.operation_key=p_operation.operation_key and r.account_id=p_operation.account_id
    and r.operation_snapshot=to_jsonb(p_operation)-'estimate_checked_at') then 0
  when exists(select 1 from icash_reliability_private.pending_work_relief_20261113 r
   join icash_reliability_private.pending_work_relief_policy_20261113 p on p.id=1 and p.enabled
   where r.operation_key=p_operation.operation_key and r.account_id=p_operation.account_id
    and r.operation_snapshot=to_jsonb(p_operation)-'estimate_checked_at') then 0
  else p_operation.charge_cap_cents end;
$$;

create function icash_reliability_private.funded_recovery_snapshot_immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Immutable funded recovery snapshot';end$$;
revoke all on function icash_reliability_private.funded_recovery_snapshot_immutable() from public,anon,authenticated,service_role;
create trigger funded_recovery_snapshot_immutable before update or delete on icash_reliability_private.pending_work_relief_20261113
 for each row execute function icash_reliability_private.funded_recovery_snapshot_immutable();
create trigger funded_recovery_snapshot_no_truncate before truncate on icash_reliability_private.pending_work_relief_20261113
 for each statement execute function icash_reliability_private.funded_recovery_snapshot_immutable();

-- Operator-only: ordinary services can read the reviewed manifest, never enable
-- or expand it. The same global lock serializes activation with final admission.
create function icash_reliability_private.activate_pending_work_relief_20261113(p_manifest text,p_release_sha text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare policy icash_reliability_private.pending_work_relief_policy_20261113;observed text;
begin
 if p_manifest is null or p_manifest!~'^[a-f0-9]{32}$' or p_release_sha is null or p_release_sha!~'^[a-f0-9]{40}$' then
  raise exception 'Exact reviewed manifest and verified release required';
 end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict policy from icash_reliability_private.pending_work_relief_policy_20261113 where id=1 for update;
 select md5(string_agg(operation_key||operation_snapshot::text,E'\n' order by operation_key)) into observed
 from icash_reliability_private.pending_work_relief_20261113;
 if observed is distinct from policy.manifest or p_manifest<>policy.manifest then
  raise exception 'Reviewed pending-work manifest changed';
 end if;
 if policy.activated_at is not null then
  if p_release_sha<>policy.release_sha then raise exception 'Relief already activated for another release';end if;
  return jsonb_build_object('activated',false,'enabled',policy.enabled,'activatedAt',policy.activated_at);
 end if;
 update icash_reliability_private.pending_work_relief_policy_20261113
 set enabled=true,activated_at=clock_timestamp(),release_sha=p_release_sha where id=1 returning * into policy;
 return jsonb_build_object('activated',true,'enabled',true,'activatedAt',policy.activated_at,
  'accounts',policy.account_count,'operations',policy.operation_count,'planningQuotesCents',policy.charge_cap_cents);
end $$;
revoke all on function icash_reliability_private.activate_pending_work_relief_20261113(text,text) from public,anon,authenticated,service_role;
