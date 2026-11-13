-- Owner-requested notification reset. Never reset operational or incident health.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(916016);
create table icash_reliability_private.notification_baselines(
 request_key text primary key check(request_key~'^[a-z0-9-]{10,120}$'),
 incident_id uuid not null references icash_reliability_private.incidents(id),
 fingerprint text not null check(fingerprint~'^[a-f0-9]{32}$'),
 snapshot_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 release_sha text not null check(release_sha~'^[a-f0-9]{40}$'),
 cancelled_notifications uuid[] not null
);
alter table icash_reliability_private.notification_baselines enable row level security;
revoke all on icash_reliability_private.notification_baselines from public,anon,authenticated,service_role;
grant select on icash_reliability_private.notification_baselines to service_role;

create function icash_reliability_private.notification_fingerprint(p_report jsonb) returns text
language sql stable security invoker set search_path='' as $$
 select case when p_report->>'fresh'='true'
  and (p_report->'snapshot'->>'checkedAt')::timestamptz between now()-interval '2 minutes' and now()
  and (p_report->'snapshot'->'accountProgress'->>'checkedAt')::timestamptz between now()-interval '2 minutes' and now()
 then md5(jsonb_build_object(
  'status',p_report->'status','worker',p_report->'components'->'worker'->'status',
  'maintenance',p_report->'components'->'maintenance'->'status',
  'issues',p_report->'snapshot'->'issues','issueCount',p_report->'snapshot'->'issueCount',
  'progress',(p_report->'snapshot'->'accountProgress')-'checkedAt'-'samples',
  'accounts',(select coalesce(jsonb_agg(jsonb_build_array(s.account_id,s.reason,s.since) order by s.account_id),'[]'::jsonb)
   from icash_reliability_private.account_work_states s),
  'quota',p_report->'snapshot'->'researchQuota'->'status'
 )::text) end;
$$;
revoke all on function icash_reliability_private.notification_fingerprint(jsonb) from public,anon,authenticated;
grant execute on function icash_reliability_private.notification_fingerprint(jsonb) to service_role;

create function icash_reliability_private.reset_notification_baseline(p_request text,p_incident uuid,p_snapshot timestamptz,p_release text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare report jsonb;fingerprint text;cancelled uuid[];
begin
 if p_request is null or p_request!~'^[a-z0-9-]{10,120}$' or p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform pg_advisory_xact_lock(916016);
 if exists(select 1 from icash_reliability_private.notification_baselines where request_key=p_request) then
  return exists(select 1 from icash_reliability_private.notification_baselines where request_key=p_request
   and incident_id=p_incident and snapshot_at=p_snapshot and release_sha=p_release);
 end if;
 if not exists(select 1 from icash_reliability_private.incidents where id=p_incident and recovered_at is null) then return false;end if;
 report:=public.icash_reliability_status();
 if p_snapshot is null or (report->'snapshot'->>'checkedAt')::timestamptz is distinct from p_snapshot then return false;end if;
 fingerprint:=icash_reliability_private.notification_fingerprint(report);
 if fingerprint is null then return false;end if;
 select coalesce(array_agg(id order by id),'{}') into cancelled from icash_reliability_private.incident_notifications
  where incident_id=p_incident and event='detected' and state='pending' and created_at<=p_snapshot;
 insert into icash_reliability_private.notification_baselines(request_key,incident_id,fingerprint,snapshot_at,release_sha,cancelled_notifications)
  values(p_request,p_incident,fingerprint,p_snapshot,p_release,cancelled);
 update icash_reliability_private.incident_notifications set state='cancelled' where id=any(cancelled) and state='pending';
 return true;
end $$;
revoke all on function icash_reliability_private.reset_notification_baseline(text,uuid,timestamptz,text) from public,anon,authenticated,service_role;

do $$
declare source text:=pg_get_functiondef('public.icash_refresh_reliability_incident(text)'::regprocedure);
 needle text:='if latest_notice.state=''accepted'' and latest_notice.accepted_at<=now()-interval ''1 hour'' then component_alert:=true;end if;';
begin
 if md5(source)<>'682e16c5e527e104d104729d21473b02' or strpos(source,needle)=0 then raise exception 'Notification observer prerequisite changed';end if;
 -- Only the unchanged hourly reminder is acknowledged. New component outages,
 -- escalations, recovery and uncertain-send protections retain their original logic.
 execute replace(source,needle,'if latest_notice.state=''accepted'' and latest_notice.accepted_at<=now()-interval ''1 hour''
   and not exists(select 1 from icash_reliability_private.notification_baselines b where b.incident_id=active.id
    and b.fingerprint=icash_reliability_private.notification_fingerprint(report)) then component_alert:=true;end if;');
 source:=pg_get_functiondef('public.icash_refresh_reliability_incident(text)'::regprocedure);
 needle:='where incident_id=active.id and event=''detected'' order by revision desc limit 1;';
 if strpos(source,needle)=0 then raise exception 'Notification history selection changed';end if;
 execute replace(source,needle,'where incident_id=active.id and event=''detected'' and state<>''cancelled'' order by revision desc limit 1;');
end $$;
commit;
