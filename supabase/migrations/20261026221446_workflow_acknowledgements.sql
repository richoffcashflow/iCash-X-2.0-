-- Owner-reviewed alert history is separate from provider outcomes and money.
-- This migration acknowledges nothing. Apply the owner's exact reviewed cohort
-- separately; the application has read access only and cannot archive new work.
begin;
set local lock_timeout='5s';
create table icash_reliability_private.workflow_acknowledgements(
 kind text not null check(kind in ('text_receipt','text_review','call_receipt','seller_response')),
 resource_id uuid not null,
 account_id uuid not null,
 since timestamptz not null,
 disposition text not null check(disposition in ('provider_failure_confirmed','terminal_call_receipt_pending','provider_outcome_unknown','outreach_blocked')),
 acknowledged_at timestamptz not null default now(),
 review_reference text not null check(length(review_reference) between 1 and 400),
 primary key(kind,resource_id,account_id,since),
 check(isfinite(since) and isfinite(acknowledged_at) and acknowledged_at>=since)
);
alter table icash_reliability_private.workflow_acknowledgements enable row level security;
revoke all on icash_reliability_private.workflow_acknowledgements from public,anon,authenticated,service_role;
grant select on icash_reliability_private.workflow_acknowledgements to service_role;

-- Activate through the compatible application release. Keep the original
-- selectors, shared lock/cache, top-25 bound and telemetry unchanged. Matching
-- includes the original timestamp: changed failures and new resources reappear.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_outreach_reliability_snapshot()'::regprocedure);
 needle:='CREATE OR REPLACE FUNCTION public.icash_refresh_outreach_reliability_snapshot()';
 if position(needle in definition)=0 then raise exception 'Reliability entry point changed';end if;
 definition:=replace(definition,needle,'CREATE OR REPLACE FUNCTION public.icash_refresh_reviewed_workflow_snapshot()');
 needle:=' ), findings as (';
 if position(needle in definition)=0 then raise exception 'Reliability findings changed';end if;
 definition:=replace(definition,needle,' ), raw_findings as (');
 needle:=' ), texts as (';
 if position(needle in definition)=0 then raise exception 'Reliability totals changed';end if;
 definition:=replace(definition,needle,$new$
 ), reviewed as materialized (
  select f.*,a.disposition,a.acknowledged_at from raw_findings f
  left join icash_reliability_private.workflow_acknowledgements a
   on a.kind=f.kind and a.resource_id=f.resource_id and a.account_id=f.account_id and a.since=f.since
 ), findings as (
  select kind,resource_id,account_id,since from reviewed where acknowledged_at is null
 ), texts as ($new$);
 needle:=$old$  'issues',coalesce($old$;
 if position(needle in definition)=0 then raise exception 'Reliability report changed';end if;
 definition:=replace(definition,needle,$new$  'acknowledgedCount',(select count(*) from reviewed where acknowledged_at is not null),
  'acknowledgedIssues',coalesce((select jsonb_agg(to_jsonb(f)) from (
   select kind,resource_id as "resourceId",account_id as "accountId",since,disposition,acknowledged_at as "acknowledgedAt"
   from reviewed where acknowledged_at is not null order by since,kind,resource_id limit 25
  ) f),'[]'::jsonb),
  'issues',coalesce($new$);
 execute definition;
end $patch$;
revoke all on function public.icash_refresh_reviewed_workflow_snapshot() from public,anon,authenticated;
grant execute on function public.icash_refresh_reviewed_workflow_snapshot() to service_role;
commit;
