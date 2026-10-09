begin;
-- New enrollments get the fullest first-week cadence within their stated limits.
create function public.icash_webinar_return_steps() returns table(step integer,channel text,delay_minutes integer,destination text)
language sql immutable security invoker set search_path='' as $$
 with schedule as (
 select 'email'::text ch,d*1440+20 mins from generate_series(0,6) d
 union all select 'email',d*1440+480 from generate_series(0,6) d
 union all select 'sms',d*1440+240 from generate_series(0,6) d
 union all select 'email',d*1440+20 from generate_series(7,27) d
 union all select 'sms',d*1440+240 from generate_series(8,28,2) d
 union all select 'email',d*1440+20 from generate_series(30,57,3) d
 union all select 'sms',d*1440+240 from unnest(array[31,38,45,52,59]) d
 ) select (199+row_number() over(order by mins,ch))::integer,ch,mins,'webinar'::text from schedule;
$$;
alter function public.icash_webinar_contact_ongoing_campaign(uuid,uuid,text,text,text,boolean,boolean) rename to icash_webinar_contact_before_return_campaign;
create function public.icash_webinar_contact_ongoing_campaign(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.icash_webinar_campaigns;
begin
 perform public.icash_webinar_contact_before_return_campaign(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);
 for c in select * from public.icash_webinar_campaigns where visitor_id=p_visitor and started_at>=now()-interval '2 minutes'
 and (channel='email' and p_email_consent and consent_version='webinar-email-ongoing-2026-10-09' or channel='sms' and p_sms_consent and consent_version='webinar-sms-ongoing-2026-10-09') loop
 if exists(select 1 from public.icash_webinar_outbox where campaign_id=c.id and step>=200) or public.icash_webinar_has_paid(p_visitor) then continue;end if;
 update public.icash_webinar_outbox set state='canceled' where campaign_id=c.id and step<200 and state in ('pending','claimed') and first_attempt_at is null;
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination)
 select c.visitor_id,c.session_id,c.channel,c.recipient,s.step,c.started_at+make_interval(mins=>s.delay_minutes),c.started_at+make_interval(mins=>s.delay_minutes)+interval '2 days',c.id,s.destination
 from public.icash_webinar_return_steps() s where s.channel=c.channel on conflict do nothing;
 end loop;
 update public.icash_webinar_outbox f set state='canceled' where visitor_id=p_visitor and state in ('pending','claimed') and not public.icash_webinar_followup_allowed(f.id);
end $$;
-- Pending content may change destination; already-sent content keeps its promise.
update public.icash_webinar_outbox set destination='webinar' where campaign_id is not null and state='pending' and payload is null;
do $$ declare body text;needle text:='case when cycle.week%2=0 then ''webinar'' else ''checkout'' end';begin
 select pg_get_functiondef('public.icash_webinar_claim_followups(boolean,boolean)'::regprocedure) into strict body;
 if position(needle in body)=0 then raise exception 'Weekly scheduler prerequisite changed';end if;
 execute replace(body,needle,'''webinar''');
end $$;
create table public.icash_webinar_reply_events(
 event_id text primary key,channel text not null check(channel in ('email','sms')),recipient text not null,
 body text not null,outcome text not null check(outcome in ('review','queued','stopped','ignored')),created_at timestamptz not null default now()
);
alter table public.icash_webinar_reply_events enable row level security;
revoke all on public.icash_webinar_reply_events from public,anon,authenticated;
grant select,insert,update on public.icash_webinar_reply_events to service_role;
alter table public.icash_webinar_outbox add column reply_event_id text unique references public.icash_webinar_reply_events(event_id);
create sequence public.icash_webinar_reply_steps start 1000000 maxvalue 2147483647;
revoke all on sequence public.icash_webinar_reply_steps from public,anon,authenticated;
grant usage on sequence public.icash_webinar_reply_steps to service_role;
-- Deliberately deterministic: replies cannot give an agent tools or change an account.
create function public.icash_webinar_reply_intent(p_body text) returns text language sql immutable security invoker set search_path='' as $$
 select case
 when lower(trim(p_body)) ~ '(^|[^a-z])(stop|unsubscribe|remove me|do not contact|don.t contact|wrong number|not interested)([^a-z]|$)' then 'stop'
 when length(p_body)>500 or lower(p_body) ~ 'refund|cancel|chargeback|charged|billing|support|help|problem|broken|error|scam|complaint|out of office|automatic reply|do not reply' then 'review'
 when lower(trim(p_body)) ~ '^(yes|yeah|yep|yup|ok|okay|ready|sure|send it|join|watch|link|send (me )?(the |a |my )?link|where.*(link|webinar|session)|how.*(join|watch)|i.*(ready|join|watch))([ .!?].*)?$' then 'return'
 else 'review' end;
$$;
create function public.icash_webinar_queue_return(p_event text,p_channel text,p_recipient text,p_body text) returns text
language plpgsql security invoker set search_path='' as $$
declare c public.icash_webinar_campaigns;v public.icash_webinar_visitors;intent text;outcome text;
begin
 perform pg_advisory_xact_lock(hashtextextended('webinar-reply:'||p_channel||':'||p_recipient,821));
 select e.outcome into outcome from public.icash_webinar_reply_events e where event_id=p_event;
 if found then return outcome;end if;
 select * into c from public.icash_webinar_campaigns where channel=p_channel and recipient=p_recipient;
 if not found then return 'ignored';end if;
 select * into v from public.icash_webinar_visitors where id=c.visitor_id for update;
 intent:=public.icash_webinar_reply_intent(p_body);
 outcome:=case when intent='stop' then 'stopped' else 'review' end;
 insert into public.icash_webinar_reply_events(event_id,channel,recipient,body,outcome) values(p_event,p_channel,p_recipient,left(p_body,4000),outcome);
 if intent='stop' then
 if p_channel='sms' then perform public.icash_webinar_text_reply(p_recipient,true);else perform public.icash_webinar_unsubscribe(v.id,'unsubscribe');end if;
 return outcome;end if;
 if intent<>'return' or public.icash_webinar_has_paid(v.id) then return outcome;end if;
 if p_channel='sms' and (v.phone is distinct from p_recipient or v.sms_consent_at is null or v.sms_opted_out_at is not null or c.consent_version<>'webinar-sms-ongoing-2026-10-09' or exists(select 1 from public.icash_text_suppressions where phone=p_recipient) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p_recipient)) then return outcome;end if;
 if p_channel='email' and (lower(v.email) is distinct from p_recipient or v.email_consent_at is null or v.opted_out_at is not null or exists(select 1 from public.icash_webinar_suppressions where email=p_recipient)) then return outcome;end if;
 -- One outstanding return link per contact, never one text for every webhook retry.
 if exists(select 1 from public.icash_webinar_outbox where channel=p_channel and recipient=p_recipient and reply_event_id is not null and (state in ('pending','claimed','sending') or first_attempt_at>now()-interval '24 hours')) then
 update public.icash_webinar_reply_events set outcome='ignored' where event_id=p_event;return 'ignored';end if;
 if p_channel='sms' then
 update public.icash_webinar_visitors set sms_replied_at=null where id=v.id;
 update public.icash_webinar_outbox set state='pending' where campaign_id=c.id and state='canceled' and first_attempt_at is null and reply_event_id is null and step>=200 and due_at>now() and expires_at>now();
 end if;
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination,reply_event_id)
 values(c.visitor_id,c.session_id,p_channel,p_recipient,nextval('public.icash_webinar_reply_steps')::integer,now(),now()+interval '2 days',c.id,'webinar',p_event);
 update public.icash_webinar_reply_events set outcome='queued' where event_id=p_event;return 'queued';
end $$;
alter function public.icash_route_lifecycle_text(jsonb,boolean) rename to icash_route_lifecycle_text_before_webinar_return;
create function public.icash_route_lifecycle_text(p_event jsonb,p_optout boolean) returns text language plpgsql security invoker set search_path='' as $$
declare role_name text;body text:=coalesce(p_event->'data'->>'body','');stop_request boolean:=p_optout;
begin
 -- Replay must not cancel a return link queued by the original event.
 perform pg_advisory_xact_lock(hashtextextended('lifecycle-event:'||(p_event->>'id'),822));
 select role into role_name from public.icash_lifecycle_text_inbox where event_id=p_event->>'id';if found then return role_name;end if;
 if exists(select 1 from public.icash_webinar_text_assignments where recipient=p_event->'data'->>'from' and sender=p_event->'data'->>'to') and not exists(select 1 from public.icash_text_threads where recipient=p_event->'data'->>'from' and sender=p_event->'data'->>'to' and retired_at is null) then stop_request:=p_optout or public.icash_webinar_reply_intent(body)='stop';end if;
 role_name:=public.icash_route_lifecycle_text_before_webinar_return(p_event,stop_request);
 if role_name='prospect' then perform public.icash_webinar_queue_return('sms:'||(p_event->>'id'),'sms',p_event->'data'->>'from',body);end if;
 return role_name;
end $$;
do $$ declare signature text;begin
 foreach signature in array array['icash_webinar_return_steps()','icash_webinar_contact_ongoing_campaign(uuid,uuid,text,text,text,boolean,boolean)','icash_webinar_reply_intent(text)','icash_webinar_queue_return(text,text,text,text)','icash_route_lifecycle_text(jsonb,boolean)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';execute 'grant execute on function public.'||signature||' to service_role';end loop;
end $$;
commit;
