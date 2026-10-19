begin;
set local lock_timeout='5s';
alter table icash_reliability_private.incidents
 add column severity text not null default 'minor' check(severity in ('minor','high','critical')),
 add column peak_severity text not null default 'minor' check(peak_severity in ('minor','high','critical'));

create function public.icash_reliability_severity(p_report jsonb,p_at timestamptz default now()) returns text
language sql stable security invoker set search_path='' as $$
 with issues as (select value item from jsonb_array_elements(case when jsonb_typeof(p_report->'snapshot'->'issues')='array' then p_report->'snapshot'->'issues' else '[]'::jsonb end))
 select case
  when p_report->'components'->'worker'->>'status' in ('degraded','unavailable') or p_report->'components'->'maintenance'->>'status' in ('degraded','unavailable') then 'critical'
  when p_report->>'fresh' is distinct from 'true' or p_report->'snapshot'->>'issueCount' is null
   or p_report->'components'->'worker'->>'status' is distinct from 'ok' or p_report->'components'->'maintenance'->>'status' is distinct from 'ok' then 'high'
  when (p_report->'snapshot'->>'issueCount')::integer=0 then case when p_report->>'status'='ok' then null else 'high' end
  when (p_report->'snapshot'->>'issueCount')::integer>=5 or (select count(distinct item->>'accountId') from issues)>=3
   or exists(select 1 from issues where item->>'kind' in ('text_receipt','text_review','call_receipt','contract_delivery','contract_preparation')
    or (item->>'since')::timestamptz<=p_at-interval '30 minutes') then 'high'
  else 'minor' end;
$$;

-- Escalate once at each higher severity, including age-only escalation. An
-- oscillating issue cannot spam the same level or replay an uncertain email.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_reliability_incident(text)'::regprocedure);
 needle:='found_count integer;';
 if position(needle in definition)=0 then raise exception 'Incident declaration changed';end if;
 definition:=replace(definition,needle,needle||'found_severity text;');
 needle:='select * into active from icash_reliability_private.incidents where recovered_at is null for update;';
 if position(needle in definition)=0 then raise exception 'Incident severity prerequisite changed';end if;
 definition:=replace(definition,needle,'found_severity:=public.icash_reliability_severity(report,now()); '||needle);
 needle:='insert into icash_reliability_private.incidents(reasons,issue_count) values(found_reasons,found_count)';
 if position(needle in definition)=0 then raise exception 'Incident creation changed';end if;
 definition:=replace(definition,needle,'insert into icash_reliability_private.incidents(reasons,issue_count,severity,peak_severity) values(found_reasons,found_count,found_severity,found_severity)');
 needle:='if not found_reasons<@active.reasons and not exists';
 if position(needle in definition)=0 then raise exception 'Incident escalation changed';end if;
 definition:=replace(definition,needle,$new$if (not found_reasons<@active.reasons or array_position(array['minor','high','critical'],found_severity)>array_position(array['minor','high','critical'],active.peak_severity)) and not exists$new$);
 needle:='set reasons=found_reasons,issue_count=found_count,updated_at=now()';
 if position(needle in definition)=0 then raise exception 'Incident update changed';end if;
 definition:=replace(definition,needle,$new$set reasons=found_reasons,issue_count=found_count,severity=found_severity,
 peak_severity=case when array_position(array['minor','high','critical'],found_severity)>array_position(array['minor','high','critical'],active.peak_severity) then found_severity else active.peak_severity end,updated_at=now()$new$);
 execute definition;
end $patch$;

-- Version responses so applying this migration cannot break an older app's
-- strict alert schema during the rolling release. Original claims own delivery.
create function public.icash_claim_reliability_notification_v2() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare claim jsonb;severity text;
begin
 claim:=public.icash_claim_reliability_notification();if claim is null then return null;end if;
 select i.severity into severity from icash_reliability_private.incidents i where i.id=(claim->>'incidentId')::uuid;
 return claim||jsonb_build_object('severity',severity);
end $$;
create function public.icash_reliability_alert_status_v2(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;severity text;
begin
 result:=public.icash_reliability_alert_status(p_actor);
 if result->'active' is not null and result->'active'<>'null'::jsonb then
  select i.severity into severity from icash_reliability_private.incidents i where i.id=(result->'active'->>'id')::uuid;
  result:=jsonb_set(result,'{active,severity}',to_jsonb(severity));
 end if;
 return result;
end $$;
revoke all on function public.icash_reliability_severity(jsonb,timestamptz),public.icash_claim_reliability_notification_v2(),public.icash_reliability_alert_status_v2(uuid) from public,anon,authenticated;
grant execute on function public.icash_reliability_severity(jsonb,timestamptz),public.icash_claim_reliability_notification_v2(),public.icash_reliability_alert_status_v2(uuid) to service_role;
commit;
