-- Core service outages have their own recovery evidence. An unresolved seller
-- receipt must not suppress a new worker outage inside the same incident.
begin;
set local lock_timeout='5s';
create table icash_reliability_private.component_outages(
 component text primary key check(component in ('worker','maintenance','monitor')),
 opened_at timestamptz,
 healthy_since timestamptz,
 last_observed_at timestamptz,
 peak_level smallint not null default 0 check(peak_level between 0 and 2)
);
insert into icash_reliability_private.component_outages(component) values('worker'),('maintenance'),('monitor');
alter table icash_reliability_private.component_outages enable row level security;
revoke all on icash_reliability_private.component_outages from public,anon,authenticated;
grant select,update on icash_reliability_private.component_outages to service_role;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_reliability_incident(text)'::regprocedure);
 if md5(definition)<>'c867ea1599bb5fdf85eed95671ecc778' then raise exception 'Incident refresh source changed; review before applying';end if;
 needle:='recovery_started_at timestamptz;';
 if position(needle in definition)=0 then raise exception 'Incident declarations changed';end if;
 definition:=replace(definition,needle,needle||$new$
 component_name text;component_state icash_reliability_private.component_outages;
 component_level smallint;component_alert boolean:=false;component_healthy_since timestamptz;
 latest_notice icash_reliability_private.incident_notifications;
$new$);
 needle:='select * into active from icash_reliability_private.incidents where recovered_at is null for update;';
 if position(needle in definition)=0 then raise exception 'Incident lock changed';end if;
 definition:=replace(definition,needle,needle||$new$
 -- The existing global transaction lock serializes observation and claiming.
 foreach component_name in array array['worker','maintenance','monitor'] loop
  select * into strict component_state from icash_reliability_private.component_outages where component=component_name for update;
  if component_name=any(found_reasons) then
   component_level:=case when report->'components'->component_name->>'status'='degraded' then 1 else 2 end;
   -- Missing heartbeats escalate even if a degraded sample already paged.
   if component_state.opened_at is null or component_level>component_state.peak_level then component_alert:=true;end if;
   update icash_reliability_private.component_outages
    set opened_at=coalesce(component_state.opened_at,now()),healthy_since=null,last_observed_at=now(),
     peak_level=greatest(component_state.peak_level,component_level)
    where component=component_name;
  elsif component_state.opened_at is not null then
   component_healthy_since:=case when component_state.healthy_since is not null and component_state.last_observed_at>=now()-interval '3 minutes'
    then component_state.healthy_since else now() end;
   update icash_reliability_private.component_outages
    set opened_at=case when component_healthy_since<=now()-interval '15 minutes' then null else component_state.opened_at end,
     healthy_since=case when component_healthy_since<=now()-interval '15 minutes' then null else component_healthy_since end,
     peak_level=case when component_healthy_since<=now()-interval '15 minutes' then 0 else component_state.peak_level end,
     last_observed_at=now() where component=component_name;
  else
   update icash_reliability_private.component_outages set last_observed_at=now() where component=component_name;
  end if;
 end loop;
 -- One current-status reminder per hour for a continuing core outage. Never
 -- replay a pending, dispatching or uncertain email; retain its delivery record.
 if active.id is not null and found_reasons&&array['worker','maintenance','monitor'] then
  select * into latest_notice from icash_reliability_private.incident_notifications
   where incident_id=active.id and event='detected' order by revision desc limit 1;
  if latest_notice.state='accepted' and latest_notice.accepted_at<=now()-interval '1 hour' then component_alert:=true;end if;
 end if;
$new$);
 needle:='if (not found_reasons<@active.seen_reasons or';
 if position(needle in definition)=0 then raise exception 'Incident escalation changed';end if;
 definition:=replace(definition,needle,'if (component_alert or not found_reasons<@active.seen_reasons or');
 execute definition;
end $patch$;
revoke all on function public.icash_refresh_reliability_incident(text) from public,anon,authenticated;
grant execute on function public.icash_refresh_reliability_incident(text) to service_role;
commit;
