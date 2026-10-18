begin;
create table public.icash_webinar_recovery_consents(
 visitor_id uuid not null references public.icash_webinar_visitors(id),session_id uuid not null references public.icash_webinar_sessions(id),
 channel text not null check(channel in ('email','sms')),recipient text not null,version text not null,accepted_at timestamptz not null default now(),
 primary key(session_id,channel,recipient,version)
);
alter table public.icash_webinar_recovery_consents enable row level security;
revoke all on public.icash_webinar_recovery_consents from public,anon,authenticated;
grant select,insert on public.icash_webinar_recovery_consents to service_role;
create index icash_webinar_recovery_consents_visitor on public.icash_webinar_recovery_consents(visitor_id,channel,recipient);
-- Only the new versioned, unchecked opt-in uses this RPC. Existing forms keep
-- their earlier RPC and limits; deploying this migration grants no new consent.
create function public.icash_webinar_contact_exit_campaign(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.icash_webinar_visitors;
begin
 perform public.icash_webinar_contact_ongoing_campaign(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);
 if not exists(select 1 from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor and not is_preview and config->>'parentWebinarId' is null) then return;end if;
 select * into v from public.icash_webinar_visitors where id=p_visitor;
 insert into public.icash_webinar_recovery_consents(visitor_id,session_id,channel,recipient,version)
 select v.id,p_session,'email',lower(v.email),'webinar-email-exit-2026-10-18' where p_email_consent and v.email is not null and v.opted_out_at is null
 union all select v.id,p_session,'sms',v.phone,'webinar-sms-exit-2026-10-18' where p_sms_consent and v.phone is not null and v.sms_opted_out_at is null
 on conflict do nothing;
 update public.icash_webinar_visitors set
 consent_version=case when p_email_consent then 'webinar-email-exit-2026-10-18' else consent_version end,
 sms_consent_version=case when p_sms_consent then 'webinar-sms-exit-2026-10-18' else sms_consent_version end where id=v.id;
end $$;
create function public.icash_webinar_exit_consent(p_visitor uuid,p_channel text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_webinar_visitors v join public.icash_webinar_recovery_consents c on c.visitor_id=v.id
 where v.id=p_visitor and c.channel=p_channel and
 (p_channel='email' and c.recipient=lower(v.email) and c.version=v.consent_version and c.version='webinar-email-exit-2026-10-18'
 or p_channel='sms' and c.recipient=v.phone and c.version=v.sms_consent_version and c.version='webinar-sms-exit-2026-10-18'));
$$;
-- Owner requested immediate, paired webinar recovery at any hour on 2026-10-18.
-- Browser presence is separate from playback checkpoints, which can arrive after
-- pagehide. Every signal is bound to the authenticated visitor/session by the API.
create table public.icash_webinar_recovery_presence(
 page_id uuid primary key,visitor_id uuid not null references public.icash_webinar_visitors(id),
 session_id uuid not null references public.icash_webinar_sessions(id),sequence bigint not null check(sequence>0),
 state text not null check(state in ('active','left','checkout')),updated_at timestamptz not null default now()
);
create index icash_webinar_recovery_presence_visitor on public.icash_webinar_recovery_presence(visitor_id,updated_at);
create table public.icash_webinar_departures(
 id uuid primary key default gen_random_uuid(),page_id uuid not null references public.icash_webinar_recovery_presence(page_id),
 visitor_id uuid not null references public.icash_webinar_visitors(id),session_id uuid not null references public.icash_webinar_sessions(id),
 sequence bigint not null,left_at timestamptz not null default now(),returned_at timestamptz,unique(page_id,sequence)
);
create index icash_webinar_departures_visitor on public.icash_webinar_departures(visitor_id) where returned_at is null;
alter table public.icash_webinar_outbox add column departure_id uuid references public.icash_webinar_departures(id);
create unique index icash_webinar_outbox_departure_channel on public.icash_webinar_outbox(departure_id,channel) where departure_id is not null;
do $$ declare t text;begin
 foreach t in array array['icash_webinar_recovery_presence','icash_webinar_departures'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create function public.icash_webinar_recovery_active(p_visitor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_webinar_visitors v join public.icash_webinar_visitors ov
 on ov.id=v.id or v.email is not null and lower(ov.email)=lower(v.email) or v.phone is not null and ov.phone=v.phone
 join public.icash_webinar_recovery_presence p on p.visitor_id=ov.id
 where v.id=p_visitor and p.state in ('active','checkout') and p.updated_at>now()-interval '75 seconds');
$$;

create function public.icash_webinar_departure_pending(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select d.returned_at is null and d.left_at>now()-interval '15 minutes'
 and p.state='left' and s.superseded_at is null and s.completed_at is null and not s.is_preview
 and not public.icash_webinar_recovery_active(v.id)
 from public.icash_webinar_departures d join public.icash_webinar_recovery_presence p on p.page_id=d.page_id
 join public.icash_webinar_sessions s on s.id=d.session_id join public.icash_webinar_visitors v on v.id=d.visitor_id
 where d.id=p_id),false);
$$;

create function public.icash_webinar_recovery_signal(p_visitor uuid,p_session uuid,p_page uuid,p_sequence bigint,p_state text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v public.icash_webinar_visitors;s public.icash_webinar_sessions;p public.icash_webinar_recovery_presence;
 identity text;departure uuid;step_number integer;queued boolean:=false;old_state text;
begin
 if p_state not in ('active','left','checkout') or p_sequence<1 or p_sequence>2147483647 then raise exception 'Invalid presence';end if;
 select * into s from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor;
 if not found then raise exception 'Session not found';end if;
 if s.is_preview or s.superseded_at is not null or s.config->>'parentWebinarId' is not null then return false;end if;
 select * into v from public.icash_webinar_visitors where id=p_visitor;
 for identity in select distinct value from unnest(array['visitor:'||v.id::text,'email:'||lower(v.email),'phone:'||v.phone]) value where value is not null order by value loop
 perform pg_advisory_xact_lock(hashtextextended(identity,815));end loop;
 select * into p from public.icash_webinar_recovery_presence where page_id=p_page for update;
 if found then
  if p.visitor_id<>p_visitor or p.session_id<>p_session then raise exception 'Page does not belong to session';end if;
  if p.sequence>=p_sequence then return false;end if;
  old_state:=p.state;
  update public.icash_webinar_recovery_presence set sequence=p_sequence,state=p_state,updated_at=now() where page_id=p_page;
 else
  insert into public.icash_webinar_recovery_presence(page_id,visitor_id,session_id,sequence,state) values(p_page,p_visitor,p_session,p_sequence,p_state);
 end if;
 if p_state<>'left' then
  with returned as (update public.icash_webinar_departures d set returned_at=now() from public.icash_webinar_visitors ov
  where d.visitor_id=ov.id and d.returned_at is null
  and (ov.id=v.id or v.email is not null and lower(ov.email)=lower(v.email) or v.phone is not null and ov.phone=v.phone) returning d.id)
  update public.icash_webinar_outbox f set state='canceled',last_error='Viewer returned or entered checkout'
  from returned d where f.departure_id=d.id and f.state in ('pending','claimed') and f.first_attempt_at is null;
  return false;
 end if;
 -- A repeated pagehide/hidden beacon cannot create another pair. Returning and
 -- leaving again is a new departure; ongoing consent may receive a new pair.
 if old_state='left' or s.completed_at is not null or public.icash_webinar_has_paid(v.id) then return false;end if;
 insert into public.icash_webinar_departures(page_id,visitor_id,session_id,sequence) values(p_page,p_visitor,p_session,p_sequence) returning id into departure;
 if not public.icash_webinar_departure_pending(departure) then return false;end if;
 step_number:=nextval('public.icash_webinar_reply_steps')::integer;
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination,departure_id)
 select v.id,s.id,c.channel,c.recipient,step_number,now()+interval '5 seconds',now()+interval '15 minutes',c.id,'webinar',departure
 from public.icash_webinar_campaigns c
 where (c.channel='email' and c.recipient=lower(v.email) and v.email_consent_at is not null and v.opted_out_at is null
    or c.channel='sms' and c.recipient=v.phone and v.sms_consent_at is not null and v.sms_opted_out_at is null and v.sms_replied_at is null)
 -- Earlier limited opt-ins retain their limits; no consent receipt is upgraded.
 and (public.icash_webinar_exit_consent(v.id,c.channel)
   or (select count(*) from public.icash_webinar_outbox x where x.channel=c.channel and x.recipient=c.recipient and x.first_attempt_at is not null)<case when c.channel='sms' then 2 else 3 end)
 on conflict do nothing;
 update public.icash_webinar_outbox f set state='canceled' where f.departure_id=departure and not public.icash_webinar_followup_allowed(f.id);
 select exists(select 1 from public.icash_webinar_outbox where departure_id=departure and state='pending') into queued;
 -- The immediate pair replaces the first scheduled round, not an extra backlog.
 update public.icash_webinar_outbox f set state='canceled',last_error='Replaced by departure reminder'
 where f.state in ('pending','claimed') and f.first_attempt_at is null and f.departure_id is null and f.reply_event_id is null and f.step=300000
 and exists(select 1 from public.icash_webinar_outbox x where x.departure_id=departure and x.state='pending' and x.channel=f.channel and x.recipient=f.recipient);
 return queued;
end $$;

-- Preserve the bounded production schedule (no weekly reenrollment).
CREATE OR REPLACE FUNCTION public.icash_webinar_return_steps()
 RETURNS TABLE(step integer, channel text, delay_minutes integer, destination text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select 300000+s.n,c.channel,s.mins,'webinar'::text
 from (values(0,15),(1,1455),(2,4335)) s(n,mins) cross join (values('email'::text),('sms'::text)) c(channel);
$function$;

CREATE OR REPLACE FUNCTION public.icash_webinar_contact_last_seen(p_visitor uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select max(other.last_seen_at) from public.icash_webinar_visitors v join public.icash_webinar_visitors other
 on other.id=v.id or (v.email is not null and lower(other.email)=lower(v.email)) or (v.phone is not null and other.phone=v.phone)
 where v.id=p_visitor;
$function$;

CREATE OR REPLACE FUNCTION public.icash_webinar_followup_allowed(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce((select not public.icash_webinar_has_paid(v.id) and case when f.channel='email' then
 v.email_consent_at is not null and v.opted_out_at is null and lower(v.email)=f.recipient and not exists(select 1 from public.icash_webinar_suppressions s where s.email=f.recipient)
 else v.sms_consent_at is not null and v.sms_opted_out_at is null and v.sms_replied_at is null and v.phone=f.recipient
 and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=f.recipient)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=f.recipient) end
 from public.icash_webinar_outbox f join public.icash_webinar_visitors v on v.id=f.visitor_id where f.id=p_id),false);
$function$;

CREATE OR REPLACE FUNCTION public.icash_webinar_claim_followups(p_email_ready boolean, p_sms_ready boolean)
 RETURNS SETOF icash_webinar_outbox
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 -- No ongoing weekly jobs and no backlog after an outage or disabled sender.
 update public.icash_webinar_outbox set state='unknown',last_error='Delivery unconfirmed; not retried' where channel='sms' and state='sending' and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox set state='failed',last_error='Retry window ended' where (state='pending' or (state in ('claimed','sending') and claimed_at<now()-interval '5 minutes')) and (attempts>=4 or first_attempt_at<now()-interval '20 hours');
 update public.icash_webinar_outbox set state='pending' where (state='claimed' or (state='sending' and channel='email')) and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox f set state='canceled' where state in ('pending','claimed') and (
 not public.icash_webinar_followup_allowed(f.id) or coalesce(expires_at,created_at+interval '7 days')<=now()
 or departure_id is not null and not public.icash_webinar_departure_pending(departure_id)
 or departure_id is null and reply_event_id is null and (created_at<=now()-interval '7 days' or campaign_id is not null and step not between 300000 and 300002));
 update public.icash_webinar_outbox f set state='canceled',last_error='Skipped an older reminder'
 where f.state='pending' and f.first_attempt_at is null and f.departure_id is null and f.reply_event_id is null and f.campaign_id is not null
 and exists(select 1 from public.icash_webinar_outbox x where x.campaign_id=f.campaign_id and x.step>f.step and x.step between 300000 and 300002 and x.due_at<=now());
 return query with candidates as (
 select f.id from public.icash_webinar_outbox f
 where f.state='pending' and f.due_at<=now() and not public.icash_webinar_recovery_active(f.visitor_id)
 and (f.departure_id is not null or public.icash_webinar_contact_last_seen(f.visitor_id)<=now()-interval '15 minutes')
 and ((f.channel='email' and p_email_ready) or (f.channel='sms' and p_sms_ready))
 order by (f.departure_id is not null) desc,(f.reply_event_id is not null) desc,f.due_at,(f.channel='sms') desc,f.id for update of f skip locked limit 25
 ) update public.icash_webinar_outbox f set state='claimed',claimed_at=now(),attempts=attempts+1 from candidates c where f.id=c.id returning f.*;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_webinar_authorize_followup(p_id uuid, p_payload jsonb)
 RETURNS icash_webinar_outbox
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.icash_webinar_outbox;v public.icash_webinar_visitors;config jsonb;identity text;candidate jsonb;recent integer;total integer;
begin
 select * into f from public.icash_webinar_outbox where id=p_id;
 if not found or f.state<>'claimed' then return null;end if;
 select * into v from public.icash_webinar_visitors where id=f.visitor_id;
 for identity in select distinct value from unnest(array['visitor:'||v.id::text,'email:'||lower(v.email),'phone:'||v.phone]) value where value is not null order by value loop
 perform pg_advisory_xact_lock(hashtextextended(identity,815));end loop;
 -- Same identity-lock order as presence cancellation; recheck the lease under lock.
 select * into f from public.icash_webinar_outbox where id=p_id for update;
 if not found or f.state<>'claimed' then return null;end if;
 select s.config into config from public.icash_messaging_settings s where id=1;
 if not public.icash_webinar_followup_allowed(f.id) or coalesce(f.expires_at,f.created_at+interval '7 days')<=now()
 or f.first_attempt_at<now()-interval '20 hours'
 or f.departure_id is not null and not public.icash_webinar_departure_pending(f.departure_id)
 or f.departure_id is null and f.reply_event_id is null and (f.created_at<=now()-interval '7 days' or f.campaign_id is not null and f.step not between 300000 and 300002) then
 update public.icash_webinar_outbox set state='canceled' where id=f.id;return null;end if;
 if not coalesce((config->>case when f.channel='email' then 'enabled' else 'smsEnabled' end)::boolean,false)
 or public.icash_webinar_recovery_active(v.id)
 or f.departure_id is null and public.icash_webinar_contact_last_seen(v.id)>now()-interval '15 minutes'
 or f.due_at>now() then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '15 minutes',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 -- Webinar recovery and scheduled reminders are not restricted by timezone.
 select count(*) filter(where coalesce(x.sent_at,x.first_attempt_at)>now()-interval '24 hours' or x.state='sending'),count(*) filter(where x.reply_event_id is null)
 into recent,total from public.icash_webinar_outbox x where x.id<>f.id and x.channel=f.channel and x.first_attempt_at is not null
 and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone);
 if f.first_attempt_at is null and f.departure_id is null and f.reply_event_id is null and (total>=3 or exists(
 select 1 from public.icash_webinar_outbox x where x.id<>f.id and x.channel=f.channel and x.step=f.step and x.first_attempt_at is not null and x.reply_event_id is null
 and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone))) then
 update public.icash_webinar_outbox set state='canceled',last_error='Reminder already sent or sequence complete' where id=f.id;return null;end if;
 -- A new real departure sends the pair promptly. Scheduled reminders still
 -- share the normal per-channel frequency budget with other lifecycle messages.
 if (f.departure_id is null or not public.icash_webinar_exit_consent(v.id,f.channel)) and (recent>=1 or not public.icash_lifecycle_frequency_ok(f.channel,f.recipient,null,f.id)) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.departure_id is not null and f.first_attempt_at is null
 and not public.icash_webinar_exit_consent(v.id,f.channel)
 and total>=(case when f.channel='sms' then 2 else 3 end) then
 update public.icash_webinar_outbox set state='canceled',last_error='Original consent reminder limit reached' where id=f.id;return null;end if;
 candidate:=coalesce(f.payload,p_payload);
 if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>16000 then raise exception 'Invalid follow-up content';end if;
 if f.channel='email' and coalesce(trim(config->>'postalAddress'),'')='' then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.campaign_id is not null and f.channel='sms' and not exists(select 1 from public.icash_webinar_text_assignments a join public.icash_webinar_text_senders s on s.phone=a.sender where a.recipient=f.recipient and s.enabled and s.phone=candidate->>'from') then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.channel='sms' then
 perform pg_advisory_xact_lock(818,1);
 if exists(select 1 from public.icash_text_threads where sender=candidate->>'from' and recipient=f.recipient and retired_at is null) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;end if;
 update public.icash_webinar_outbox set state='sending',payload=candidate,first_attempt_at=coalesce(first_attempt_at,now()),claimed_at=now() where id=f.id returning * into f;
 return f;
end $function$;

do $$ declare signature text;begin
 foreach signature in array array['icash_webinar_contact_exit_campaign(uuid,uuid,text,text,text,boolean,boolean)','icash_webinar_exit_consent(uuid,text)','icash_webinar_recovery_active(uuid)','icash_webinar_departure_pending(uuid)','icash_webinar_recovery_signal(uuid,uuid,uuid,bigint,text)','icash_webinar_return_steps()','icash_webinar_contact_last_seen(uuid)','icash_webinar_followup_allowed(uuid)','icash_webinar_claim_followups(boolean,boolean)','icash_webinar_authorize_followup(uuid,jsonb)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
 execute 'grant execute on function public.'||signature||' to service_role';
 end loop;
end $$;
-- New opt-in still includes the existing post-purchase access/customer updates.
do $webinar_exit_customer_consent$
declare signature text;body text;
begin
 foreach signature in array array['public.icash_webinar_activate_customers()','public.icash_purchase_text_contact(uuid,uuid)'] loop
  if to_regprocedure(signature) is null then continue;end if;
  select pg_get_functiondef(to_regprocedure(signature)) into strict body;
  if position('''webinar-sms-ongoing-2026-10-09''' in body)=0 then raise exception 'Customer consent prerequisite changed: %',signature;end if;
  body:=replace(body,'''webinar-email-ongoing-2026-10-09''','''webinar-email-ongoing-2026-10-09'',''webinar-email-exit-2026-10-18''');
  body:=replace(body,'''webinar-sms-ongoing-2026-10-09''','''webinar-sms-ongoing-2026-10-09'',''webinar-sms-exit-2026-10-18''');
  execute body;
 end loop;
end $webinar_exit_customer_consent$;
notify pgrst,'reload schema';
commit;
