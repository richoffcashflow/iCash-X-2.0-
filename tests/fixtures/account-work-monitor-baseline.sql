create table icash_reliability_private.heartbeats(component text primary key,status text,checked_at timestamptz);
create table icash_reliability_private.snapshots(id integer primary key,checked_at timestamptz,report jsonb);
insert into icash_reliability_private.heartbeats values('worker','ok',now()),('maintenance','ok',now());
create function public.icash_refresh_reviewed_workflow_snapshot() returns jsonb language plpgsql set search_path=public as $$declare r jsonb;begin
 r:=jsonb_build_object('checkedAt',now(),'issueCount',1,'issues','[]'::jsonb,'texts',jsonb_build_object('accepted',0,'delivered',0,'review',0),'contracts',jsonb_build_object('created',0,'completed',0,'review',0));
 insert into icash_reliability_private.snapshots values(1,now(),r) on conflict(id) do update set checked_at=now(),report=excluded.report;return r;
end$$;
CREATE OR REPLACE FUNCTION public.icash_reliability_severity(p_report jsonb, p_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with issues as (select value item from jsonb_array_elements(case when jsonb_typeof(p_report->'snapshot'->'issues')='array' then p_report->'snapshot'->'issues' else '[]'::jsonb end))
 select case
  when p_report->'components'->'worker'->>'status' in ('degraded','unavailable') or p_report->'components'->'maintenance'->>'status' in ('degraded','unavailable') then 'critical'
  when p_report->>'fresh' is distinct from 'true' or p_report->'snapshot'->>'issueCount' is null
   or p_report->'components'->'worker'->>'status' is distinct from 'ok' or p_report->'components'->'maintenance'->>'status' is distinct from 'ok' then 'high'
  when (p_report->'snapshot'->>'issueCount')::integer=0 then case when p_report->>'status'='ok' then null else 'high' end
  when (p_report->'snapshot'->>'issueCount')::integer>=5 or (select count(distinct item->>'accountId') from issues)>=3
   or exists(select 1 from issues where item->>'kind' in ('text_receipt','text_review','call_receipt','contract_delivery','contract_preparation','owner_export')
    or (item->>'since')::timestamptz<=p_at-interval '30 minutes') then 'high'
  else 'minor' end;
$function$
;
CREATE OR REPLACE FUNCTION public.icash_reliability_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with components as (
  select wanted.component,case when h.checked_at is null or h.checked_at<now()-interval '3 minutes' then 'unavailable' else h.status end status,h.checked_at
  from (values('worker'),('maintenance')) wanted(component) left join icash_reliability_private.heartbeats h on h.component=wanted.component
 ), snapshot as (select * from icash_reliability_private.snapshots where id=1)
 select jsonb_build_object(
  'status',case when not exists(select 1 from snapshot where checked_at>=now()-interval '3 minutes') or exists(select 1 from components where status<>'ok') or coalesce((select (report->>'issueCount')::bigint from snapshot),0)>0 then 'degraded' else 'ok' end,
  'fresh',exists(select 1 from snapshot where checked_at>=now()-interval '3 minutes'),
  'components',(select jsonb_object_agg(component,jsonb_build_object('status',status,'checkedAt',checked_at)) from components),
  'snapshot',(select report from snapshot));
$function$
;
grant select,insert,update on all tables in schema icash_reliability_private to service_role;
