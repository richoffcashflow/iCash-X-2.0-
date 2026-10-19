-- A successful sample between recurring failures is not a recovered incident.
-- Keep immediate detection/escalation, but require 15 minutes of observed health
-- before recovery. A monitoring gap resets that evidence rather than counting
-- unobserved time as healthy. Track all reasons so reason oscillation cannot
-- repeatedly page the owner for the same failure within one incident.
begin;
set local lock_timeout='5s';
alter table icash_reliability_private.incidents
 add column healthy_since timestamptz,
 add column last_observed_at timestamptz,
 add column seen_reasons text[] not null default '{}' check(seen_reasons<@array['worker','maintenance','monitor','workflows']::text[]);
update icash_reliability_private.incidents set seen_reasons=reasons;

create or replace function public.icash_refresh_reliability_incident(p_configuration text) returns boolean
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare report jsonb;active icash_reliability_private.incidents;found_reasons text[]:='{}';found_count integer;found_severity text;recovery_started_at timestamptz;
begin
 if p_configuration is null or p_configuration not in ('disabled','unconfigured','ready','recipient_unverified') then raise exception 'Invalid alert configuration';end if;
 perform pg_advisory_xact_lock(916016);
 update icash_reliability_private.alert_delivery set configuration=p_configuration,checked_at=now() where id=1;
 report:=public.icash_reliability_status();
 if report is null or report->>'status' is null or report->>'status' not in ('ok','degraded') then raise exception 'Monitor unavailable';end if;
 if report->'components'->'worker'->>'status' is distinct from 'ok' then found_reasons:=array_append(found_reasons,'worker');end if;
 if report->'components'->'maintenance'->>'status' is distinct from 'ok' then found_reasons:=array_append(found_reasons,'maintenance');end if;
 if report->>'fresh' is distinct from 'true' or report->'snapshot'->>'issueCount' is null then found_reasons:=array_append(found_reasons,'monitor');end if;
 found_count:=coalesce((report->'snapshot'->>'issueCount')::integer,0);
 if found_count>0 then found_reasons:=array_append(found_reasons,'workflows');end if;
 if found_count<0 or report->>'status'='ok' and cardinality(found_reasons)>0 then raise exception 'Monitor unavailable';end if;
 found_severity:=public.icash_reliability_severity(report,now());
 select * into active from icash_reliability_private.incidents where recovered_at is null for update;
 if report->>'status'='degraded' then
  if active.id is null then
   insert into icash_reliability_private.incidents(reasons,seen_reasons,issue_count,severity,peak_severity,last_observed_at)
    values(found_reasons,found_reasons,found_count,found_severity,found_severity,now()) returning * into active;
   insert into icash_reliability_private.incident_notifications(incident_id,event) values(active.id,'detected');
  else
   -- A genuinely new failure or higher peak still alerts immediately.
   if (not found_reasons<@active.seen_reasons or array_position(array['minor','high','critical'],found_severity)>array_position(array['minor','high','critical'],active.peak_severity))
    and not exists(select 1 from icash_reliability_private.incident_notifications where incident_id=active.id and event='detected' and state='pending') then
    insert into icash_reliability_private.incident_notifications(incident_id,event,revision)
     select active.id,'detected',coalesce(max(revision),0)+1 from icash_reliability_private.incident_notifications where incident_id=active.id and event='detected';
   end if;
   update icash_reliability_private.incidents set reasons=found_reasons,issue_count=found_count,severity=found_severity,
    seen_reasons=array(select distinct reason from unnest(active.seen_reasons||found_reasons) reason order by reason),
    peak_severity=case when array_position(array['minor','high','critical'],found_severity)>array_position(array['minor','high','critical'],active.peak_severity) then found_severity else active.peak_severity end,
    healthy_since=null,last_observed_at=now(),updated_at=now() where id=active.id;
  end if;
 elsif active.id is not null then
  recovery_started_at:=case when active.healthy_since is not null and active.last_observed_at>=now()-interval '3 minutes' then active.healthy_since else now() end;
  update icash_reliability_private.incidents set healthy_since=recovery_started_at,last_observed_at=now(),updated_at=now() where id=active.id;
  if recovery_started_at<=now()-interval '15 minutes' then
   update icash_reliability_private.incidents set recovered_at=now() where id=active.id;
   -- Preserve original delivery receipts and never retry an uncertain send.
   if exists(select 1 from icash_reliability_private.incident_notifications where incident_id=active.id and event='detected' and state in ('dispatching','accepted','needs_review')) then
    insert into icash_reliability_private.incident_notifications(incident_id,event) values(active.id,'recovered') on conflict do nothing;
   end if;
  end if;
 end if;
 update icash_reliability_private.incident_notifications n set state='cancelled' where n.state='pending' and (
  n.created_at<now()-interval '24 hours' or n.event='detected' and exists(select 1 from icash_reliability_private.incidents i where i.id=n.incident_id and i.recovered_at is not null)
  or n.event='recovered' and exists(select 1 from icash_reliability_private.incidents i where i.recovered_at is null));
 update icash_reliability_private.incident_notifications set state='needs_review' where state='dispatching' and claimed_at<now()-interval '5 minutes';
 delete from icash_reliability_private.workspace_experience where (account_id,observed_day,event,stage) in(select account_id,observed_day,event,stage from icash_reliability_private.workspace_experience where observed_day<(now() at time zone 'UTC')::date-30 order by observed_day limit 2000);
 delete from icash_reliability_private.experience_admission where account_id in(select account_id from icash_reliability_private.experience_admission where updated_at<now()-interval '31 days' limit 2000);
 return exists(select 1 from icash_reliability_private.incident_notifications where state='pending');
end $$;

-- Do not deliver a queued failure notice while sustained recovery is being
-- observed. Keep the original pending claim for a recurrence; stable recovery
-- cancels it through the same incident lifecycle as before.
create or replace function public.icash_claim_reliability_notification() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare notification icash_reliability_private.incident_notifications;incident icash_reliability_private.incidents;
begin
 perform pg_advisory_xact_lock(916016);
 if not exists(select 1 from icash_reliability_private.alert_delivery where id=1 and configuration='ready' and checked_at>now()-interval '3 minutes') then return null;end if;
 if(select count(*) from icash_reliability_private.incident_notifications where claimed_at>now()-interval '1 hour')>=6 then return null;end if;
 select n.* into notification from icash_reliability_private.incident_notifications n
  join icash_reliability_private.incidents i on i.id=n.incident_id
  where n.state='pending' and n.created_at>=now()-interval '24 hours' and (n.event<>'detected' or i.healthy_since is null)
  order by n.created_at,n.id limit 1 for update of n;
 if not found then return null;end if;
 select * into incident from icash_reliability_private.incidents where id=notification.incident_id;
 if notification.event='detected' and incident.recovered_at is not null or notification.event='recovered' and exists(select 1 from icash_reliability_private.incidents where recovered_at is null) then
  update icash_reliability_private.incident_notifications set state='cancelled' where id=notification.id;return null;
 end if;
 update icash_reliability_private.incident_notifications set state='dispatching',claimed_at=now() where id=notification.id;
 return jsonb_build_object('id',notification.id,'incidentId',incident.id,'event',notification.event,'openedAt',incident.opened_at,'reasons',incident.reasons,'issueCount',incident.issue_count);
end $$;
revoke all on function public.icash_refresh_reliability_incident(text),public.icash_claim_reliability_notification() from public,anon,authenticated;
grant execute on function public.icash_refresh_reliability_incident(text),public.icash_claim_reliability_notification() to service_role;
commit;
