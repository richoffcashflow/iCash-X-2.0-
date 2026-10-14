begin;
-- Private diagnostic counters. No browser text, URLs, identities, or request bodies.
create table icash_reliability_private.workspace_experience(
 account_id uuid not null references public.icash_accounts(id) on delete cascade,
 observed_day date not null,event text not null check(event in ('panel_error','panel_retry','panel_open','action_complete')),
 stage text not null check(stage in ('workspace','property','buyers','buyer_details','documents','closing','messages','account')),
 observations integer not null default 1 check(observations between 1 and 1000),
 last_observed_at timestamptz not null default now(),
 primary key(account_id,observed_day,event,stage)
);
create index icash_workspace_experience_recent on icash_reliability_private.workspace_experience(observed_day);
create table icash_reliability_private.experience_admission(
 account_id uuid primary key references public.icash_accounts(id) on delete cascade,
 window_started timestamptz not null default now(),accepted integer not null default 0 check(accepted between 0 and 20),
 updated_at timestamptz not null default now()
);
create table icash_reliability_private.incidents(
 id uuid primary key default gen_random_uuid(),opened_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 recovered_at timestamptz,reasons text[] not null check(reasons<@array['worker','maintenance','monitor','workflows']::text[]),issue_count integer not null check(issue_count>=0)
);
create unique index icash_one_active_incident on icash_reliability_private.incidents((true)) where recovered_at is null;
create table icash_reliability_private.incident_notifications(
 id uuid primary key default gen_random_uuid(),incident_id uuid not null references icash_reliability_private.incidents(id),
 event text not null check(event in ('detected','recovered')),state text not null default 'pending' check(state in ('pending','dispatching','accepted','needs_review','cancelled')),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),claimed_at timestamptz,accepted_at timestamptz,provider_id uuid,
 unique(incident_id,event,revision)
);
create index icash_incident_notifications_pending on icash_reliability_private.incident_notifications(created_at) where state='pending';
create index icash_incident_notifications_claimed on icash_reliability_private.incident_notifications(claimed_at) where claimed_at is not null;
create table icash_reliability_private.alert_delivery(
 id integer primary key check(id=1),configuration text not null check(configuration in ('disabled','unconfigured','ready','recipient_unverified')),
 checked_at timestamptz
);
insert into icash_reliability_private.alert_delivery values(1,'disabled',null);
alter table icash_reliability_private.workspace_experience enable row level security;
alter table icash_reliability_private.experience_admission enable row level security;
alter table icash_reliability_private.incidents enable row level security;
alter table icash_reliability_private.incident_notifications enable row level security;
alter table icash_reliability_private.alert_delivery enable row level security;
revoke all on icash_reliability_private.workspace_experience,icash_reliability_private.experience_admission,icash_reliability_private.incidents,icash_reliability_private.incident_notifications,icash_reliability_private.alert_delivery from public,anon,authenticated;
grant select,insert,update,delete on icash_reliability_private.workspace_experience,icash_reliability_private.experience_admission to service_role;
grant select,insert,update on icash_reliability_private.incidents,icash_reliability_private.incident_notifications,icash_reliability_private.alert_delivery to service_role;

create function public.icash_record_workspace_experience(p_account uuid,p_user uuid,p_event text,p_stage text) returns boolean
language plpgsql security invoker set search_path='' set statement_timeout='3s' as $$
declare admission icash_reliability_private.experience_admission;today date:=(now() at time zone 'UTC')::date;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account required';end if;
 if p_event is null or p_event not in ('panel_error','panel_retry','panel_open','action_complete') or p_stage is null or p_stage not in ('workspace','property','buyers','buyer_details','documents','closing','messages','account') then raise exception 'Invalid diagnostic';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,916015));
 -- One observation per account/event/stage per minute, across tabs and instances.
 if exists(select 1 from icash_reliability_private.workspace_experience where account_id=p_account and observed_day=today and event=p_event and stage=p_stage and last_observed_at>now()-interval '1 minute') then return false;end if;
 insert into icash_reliability_private.experience_admission(account_id) values(p_account) on conflict do nothing;
 select * into admission from icash_reliability_private.experience_admission where account_id=p_account for update;
 if admission.window_started<=now()-interval '1 minute' then admission.accepted:=0;admission.window_started:=now();end if;
 if admission.accepted>=20 or (select coalesce(sum(observations),0) from icash_reliability_private.workspace_experience where account_id=p_account and observed_day=today)>=1000 then return false;end if;
 update icash_reliability_private.experience_admission set window_started=admission.window_started,accepted=admission.accepted+1,updated_at=now() where account_id=p_account;
 insert into icash_reliability_private.workspace_experience(account_id,observed_day,event,stage) values(p_account,today,p_event,p_stage)
 on conflict(account_id,observed_day,event,stage) do update set observations=icash_reliability_private.workspace_experience.observations+1,last_observed_at=now();
 return true;
end $$;

create function public.icash_workspace_experience_summary(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare report jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 select jsonb_build_object('days',7,'lastObservedAt',(select max(last_observed_at) from icash_reliability_private.workspace_experience where observed_day>=(now() at time zone 'UTC')::date-6),
  'counts',coalesce((select jsonb_agg(to_jsonb(t)) from(select event,stage,sum(observations) as count,count(distinct account_id) as accounts from icash_reliability_private.workspace_experience where observed_day>=(now() at time zone 'UTC')::date-6 group by event,stage order by event,stage)t),'[]'::jsonb)) into report;
 return report;
end $$;

create function public.icash_refresh_reliability_incident(p_configuration text) returns boolean
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare report jsonb;active icash_reliability_private.incidents;found_reasons text[]:='{}';found_count integer;
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
 select * into active from icash_reliability_private.incidents where recovered_at is null for update;
 if report->>'status'='degraded' then
  if active.id is null then
   insert into icash_reliability_private.incidents(reasons,issue_count) values(found_reasons,found_count) returning * into active;
   insert into icash_reliability_private.incident_notifications(incident_id,event) values(active.id,'detected');
  else
   -- A new worker/maintenance failure must not be hidden behind an older workflow incident.
   if not found_reasons<@active.reasons and not exists(select 1 from icash_reliability_private.incident_notifications where incident_id=active.id and event='detected' and state='pending') then
    insert into icash_reliability_private.incident_notifications(incident_id,event,revision)
     select active.id,'detected',coalesce(max(revision),0)+1 from icash_reliability_private.incident_notifications where incident_id=active.id and event='detected';
   end if;
   update icash_reliability_private.incidents set reasons=found_reasons,issue_count=found_count,updated_at=now() where id=active.id;
  end if;
 elsif active.id is not null then
  update icash_reliability_private.incidents set recovered_at=now(),updated_at=now() where id=active.id;
  -- Recovery mail is useful only if the detection was attempted. Always retain the incident history.
  if exists(select 1 from icash_reliability_private.incident_notifications where incident_id=active.id and event='detected' and state in ('dispatching','accepted','needs_review')) then
   insert into icash_reliability_private.incident_notifications(incident_id,event) values(active.id,'recovered') on conflict do nothing;
  end if;
 end if;
 -- Expired/obsolete queued messages never become an old-alert burst after configuration is repaired.
 update icash_reliability_private.incident_notifications n set state='cancelled' where n.state='pending' and (
  n.created_at<now()-interval '24 hours' or n.event='detected' and exists(select 1 from icash_reliability_private.incidents i where i.id=n.incident_id and i.recovered_at is not null)
  or n.event='recovered' and exists(select 1 from icash_reliability_private.incidents i where i.recovered_at is null));
 update icash_reliability_private.incident_notifications set state='needs_review' where state='dispatching' and claimed_at<now()-interval '5 minutes';
 -- Bounded retention cleanup; diagnostic counters are not transaction evidence.
 delete from icash_reliability_private.workspace_experience where (account_id,observed_day,event,stage) in(select account_id,observed_day,event,stage from icash_reliability_private.workspace_experience where observed_day<(now() at time zone 'UTC')::date-30 order by observed_day limit 2000);
 delete from icash_reliability_private.experience_admission where account_id in(select account_id from icash_reliability_private.experience_admission where updated_at<now()-interval '31 days' limit 2000);
 return exists(select 1 from icash_reliability_private.incident_notifications where state='pending');
end $$;

create function public.icash_claim_reliability_notification() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare notification icash_reliability_private.incident_notifications;incident icash_reliability_private.incidents;
begin
 perform pg_advisory_xact_lock(916016);
 if not exists(select 1 from icash_reliability_private.alert_delivery where id=1 and configuration='ready' and checked_at>now()-interval '3 minutes') then return null;end if;
 if(select count(*) from icash_reliability_private.incident_notifications where claimed_at>now()-interval '1 hour')>=6 then return null;end if;
 select * into notification from icash_reliability_private.incident_notifications where state='pending' and created_at>=now()-interval '24 hours' order by created_at,id limit 1 for update;
 if not found then return null;end if;
 select * into incident from icash_reliability_private.incidents where id=notification.incident_id;
 if notification.event='detected' and incident.recovered_at is not null or notification.event='recovered' and exists(select 1 from icash_reliability_private.incidents where recovered_at is null) then
  update icash_reliability_private.incident_notifications set state='cancelled' where id=notification.id;return null;
 end if;
 update icash_reliability_private.incident_notifications set state='dispatching',claimed_at=now() where id=notification.id;
 return jsonb_build_object('id',notification.id,'incidentId',incident.id,'event',notification.event,'openedAt',incident.opened_at,'reasons',incident.reasons,'issueCount',incident.issue_count);
end $$;

create function public.icash_finish_reliability_notification(p_id uuid,p_provider uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare notification icash_reliability_private.incident_notifications;
begin
 select * into notification from icash_reliability_private.incident_notifications where id=p_id for update;
 if not found then raise exception 'Notification not found';end if;
 if notification.state='accepted' and notification.provider_id=p_provider then return;end if;
 if notification.state not in ('dispatching','needs_review') or notification.provider_id is not null then raise exception 'Receipt needs review';end if;
 update icash_reliability_private.incident_notifications set state=case when p_provider is null then 'needs_review' else 'accepted' end,provider_id=p_provider,accepted_at=case when p_provider is not null then now() end where id=p_id;
end $$;

create function public.icash_reliability_alert_status(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 return jsonb_build_object('configuration',(select configuration from icash_reliability_private.alert_delivery where id=1),'checkedAt',(select checked_at from icash_reliability_private.alert_delivery where id=1),
  'active',(select jsonb_build_object('id',id,'openedAt',opened_at,'issueCount',issue_count,'reasons',reasons) from icash_reliability_private.incidents where recovered_at is null),
  'notifications',(select jsonb_build_object('pending',count(*) filter(where state='pending'),'accepted',count(*) filter(where state='accepted'),'needsReview',count(*) filter(where state='needs_review' or state='dispatching' and claimed_at<now()-interval '5 minutes')) from icash_reliability_private.incident_notifications where created_at>=now()-interval '7 days'),
  'lastNotificationAt',(select max(accepted_at) from icash_reliability_private.incident_notifications));
end $$;

revoke all on function public.icash_record_workspace_experience(uuid,uuid,text,text),public.icash_workspace_experience_summary(uuid),public.icash_refresh_reliability_incident(text),public.icash_claim_reliability_notification(),public.icash_finish_reliability_notification(uuid,uuid),public.icash_reliability_alert_status(uuid) from public,anon,authenticated;
grant execute on function public.icash_record_workspace_experience(uuid,uuid,text,text),public.icash_workspace_experience_summary(uuid),public.icash_refresh_reliability_incident(text),public.icash_claim_reliability_notification(),public.icash_finish_reliability_notification(uuid,uuid),public.icash_reliability_alert_status(uuid) to service_role;
commit;
