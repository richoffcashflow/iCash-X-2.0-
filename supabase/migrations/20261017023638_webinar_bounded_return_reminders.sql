begin;
-- Three opportunities, with email/SMS alternatives for each. Final admission
-- permits one channel per opportunity and one message per contact per 24 hours.
create or replace function public.icash_webinar_return_steps() returns table(step integer,channel text,delay_minutes integer,destination text)
language sql immutable security invoker set search_path='' as $$
 select 300000+s.n,c.channel,s.mins,'webinar'::text
 from (values(0,15),(1,1455),(2,4335)) s(n,mins) cross join (values('email'::text),('sms'::text)) c(channel);
$$;
create or replace function public.icash_webinar_campaign_steps() returns table(step integer,channel text,delay_minutes integer,destination text)
language sql immutable security invoker set search_path='' as $$ select * from public.icash_webinar_return_steps(); $$;

create function public.icash_webinar_contact_bounded_campaign(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_webinar_contact_ongoing_campaign(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);
 if not exists(select 1 from public.icash_webinar_sessions s join public.icash_webinars w on w.id=s.webinar_id where s.id=p_session and s.visitor_id=p_visitor and not s.is_preview and w.parent_webinar_id is null) then return;end if;
 update public.icash_webinar_visitors set
 consent_version=case when p_email_consent and email_consent_at is not null then 'webinar-email-bounded-2026-10-17' else consent_version end,
 sms_consent_version=case when p_sms_consent and sms_consent_at is not null then 'webinar-sms-bounded-2026-10-17' else sms_consent_version end where id=p_visitor;
 update public.icash_webinar_campaigns c set consent_version=case when c.channel='email' then v.consent_version else v.sms_consent_version end
 from public.icash_webinar_visitors v where c.visitor_id=p_visitor and v.id=c.visitor_id
 and (c.channel='email' and p_email_consent and c.recipient=lower(v.email) and v.opted_out_at is null
 or c.channel='sms' and p_sms_consent and c.recipient=v.phone and v.sms_opted_out_at is null and v.sms_replied_at is null);
end $$;

create function public.icash_webinar_contact_last_seen(p_visitor uuid) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select max(other.last_seen_at) from public.icash_webinar_visitors v join public.icash_webinar_visitors other
 on other.id=v.id or (v.email is not null and lower(other.email)=lower(v.email)) or (v.phone is not null and other.phone=v.phone)
 where v.id=p_visitor;
$$;

-- Move only still-active, unattempted enrollments into the shorter sequence.
-- Canceled campaigns, sent content, consent receipts and opt-outs stay untouched.
with active as materialized (
 select distinct c.* from public.icash_webinar_campaigns c join public.icash_webinar_outbox f on f.campaign_id=c.id
 where f.state in ('pending','claimed') and f.first_attempt_at is null and f.reply_event_id is null
 and c.started_at>now()-interval '7 days' and public.icash_webinar_followup_allowed(f.id)
), canceled as (
 update public.icash_webinar_outbox set state='canceled',last_error='Replaced by bounded return reminders'
 where state in ('pending','claimed') and first_attempt_at is null and reply_event_id is null and campaign_id is not null and step not between 300000 and 300002
 returning id
)
insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination)
select c.visitor_id,c.session_id,c.channel,c.recipient,s.step,c.started_at+make_interval(mins=>s.delay_minutes),
 least(c.started_at+interval '7 days',c.started_at+make_interval(mins=>s.delay_minutes)+interval '2 days'),c.id,s.destination
from active c join public.icash_webinar_return_steps() s on s.channel=c.channel on conflict do nothing;

create or replace function public.icash_webinar_claim_followups(p_email_ready boolean,p_sms_ready boolean) returns setof public.icash_webinar_outbox
language plpgsql security invoker set search_path='' as $$
begin
 -- No ongoing weekly jobs and no backlog after an outage or disabled sender.
 update public.icash_webinar_outbox set state='unknown',last_error='Delivery unconfirmed; not retried' where channel='sms' and state='sending' and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox set state='failed',last_error='Retry window ended' where (state='pending' or (state in ('claimed','sending') and claimed_at<now()-interval '5 minutes')) and (attempts>=4 or first_attempt_at<now()-interval '20 hours');
 update public.icash_webinar_outbox set state='pending' where (state='claimed' or (state='sending' and channel='email')) and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox f set state='canceled' where state in ('pending','claimed') and (
 not public.icash_webinar_followup_allowed(f.id) or coalesce(expires_at,created_at+interval '7 days')<=now()
 or reply_event_id is null and (created_at<=now()-interval '7 days' or campaign_id is not null and step not between 300000 and 300002));
 update public.icash_webinar_outbox f set state='canceled',last_error='Skipped an older reminder'
 where f.state='pending' and f.first_attempt_at is null and f.reply_event_id is null and f.campaign_id is not null
 and exists(select 1 from public.icash_webinar_outbox x where x.campaign_id=f.campaign_id and x.step>f.step and x.step between 300000 and 300002 and x.due_at<=now());
 return query with candidates as (
 select f.id from public.icash_webinar_outbox f
 where f.state='pending' and f.due_at<=now() and public.icash_webinar_contact_last_seen(f.visitor_id)<=now()-interval '15 minutes'
 and ((f.channel='email' and p_email_ready) or (f.channel='sms' and p_sms_ready))
 order by (f.reply_event_id is not null) desc,f.due_at,(f.channel='sms') desc,f.id for update of f skip locked limit 25
 ) update public.icash_webinar_outbox f set state='claimed',claimed_at=now(),attempts=attempts+1 from candidates c where f.id=c.id returning f.*;
end $$;

create or replace function public.icash_webinar_authorize_followup(p_id uuid,p_payload jsonb) returns public.icash_webinar_outbox
language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox;v public.icash_webinar_visitors;config jsonb;identity text;candidate jsonb;local_hour integer;recent integer;total integer;
begin
 select * into f from public.icash_webinar_outbox where id=p_id for update;
 if not found or f.state<>'claimed' then return null;end if;
 select * into v from public.icash_webinar_visitors where id=f.visitor_id;
 for identity in select distinct value from unnest(array['visitor:'||v.id::text,'email:'||lower(v.email),'phone:'||v.phone]) value where value is not null order by value loop
 perform pg_advisory_xact_lock(hashtextextended(identity,815));end loop;
 select s.config into config from public.icash_messaging_settings s where id=1;
 if not public.icash_webinar_followup_allowed(f.id) or coalesce(f.expires_at,f.created_at+interval '7 days')<=now()
 or f.first_attempt_at<now()-interval '20 hours'
 or f.reply_event_id is null and (f.created_at<=now()-interval '7 days' or f.campaign_id is not null and f.step not between 300000 and 300002) then
 update public.icash_webinar_outbox set state='canceled' where id=f.id;return null;end if;
 if not coalesce((config->>case when f.channel='email' then 'enabled' else 'smsEnabled' end)::boolean,false)
 or public.icash_webinar_contact_last_seen(v.id)>now()-interval '15 minutes' then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '15 minutes',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 begin local_hour:=extract(hour from now() at time zone v.timezone);exception when invalid_parameter_value then local_hour:=0;end;
 if local_hour is null or local_hour<9 or local_hour>=20 then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 select count(*) filter(where coalesce(x.sent_at,x.first_attempt_at)>now()-interval '24 hours' or x.state='sending'),count(*) filter(where x.reply_event_id is null)
 into recent,total from public.icash_webinar_outbox x where x.id<>f.id and x.first_attempt_at is not null
 and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone);
 if f.first_attempt_at is null and f.reply_event_id is null and (total>=3 or exists(
 select 1 from public.icash_webinar_outbox x where x.id<>f.id and x.step=f.step and x.first_attempt_at is not null and x.reply_event_id is null
 and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone))) then
 update public.icash_webinar_outbox set state='canceled',last_error='Reminder already sent or sequence complete' where id=f.id;return null;end if;
 if recent>=1 or not public.icash_lifecycle_frequency_ok(f.channel,f.recipient,null,f.id) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
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
end $$;

-- A requested return link does not restart a canceled marketing sequence.
do $$ declare body text;old text;begin
 select pg_get_functiondef('public.icash_webinar_queue_return(text,text,text,text)'::regprocedure) into strict body;
 old:='c.consent_version<>''webinar-sms-ongoing-2026-10-09''';
 if position(old in body)=0 then raise exception 'Return reply consent prerequisite changed';end if;
 body:=replace(body,old,'c.consent_version not in (''webinar-sms-ongoing-2026-10-09'',''webinar-sms-bounded-2026-10-17'')');
 old:='update public.icash_webinar_outbox set state=''pending'' where campaign_id=c.id and state=''canceled'' and first_attempt_at is null and reply_event_id is null and step>=200 and due_at>now() and expires_at>now();';
 if position(old in body)=0 then raise exception 'Return reply reactivation prerequisite changed';end if;
 execute replace(body,old,'-- A direct request queues only its own return link.');
 select pg_get_functiondef('public.icash_webinar_activate_customers()'::regprocedure) into strict body;
 if position('''webinar-email-ongoing-2026-10-09''' in body)=0 or position('''webinar-sms-ongoing-2026-10-09''' in body)=0 then raise exception 'Customer update consent prerequisite changed';end if;
 body:=replace(body,'''webinar-email-ongoing-2026-10-09''','''webinar-email-ongoing-2026-10-09'',''webinar-email-bounded-2026-10-17''');
 execute replace(body,'''webinar-sms-ongoing-2026-10-09''','''webinar-sms-ongoing-2026-10-09'',''webinar-sms-bounded-2026-10-17''');
end $$;

do $$ declare signature text;begin
 foreach signature in array array['icash_webinar_contact_bounded_campaign(uuid,uuid,text,text,text,boolean,boolean)','icash_webinar_contact_last_seen(uuid)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
 execute 'grant execute on function public.'||signature||' to service_role';end loop;
end $$;
commit;
