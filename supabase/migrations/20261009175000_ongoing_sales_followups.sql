-- New opt-ins receive an ongoing campaign. Older consent keeps its original limits.
begin;
create function public.icash_webinar_contact_ongoing_campaign(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_webinar_contact_campaign(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);
 if not exists(select 1 from public.icash_webinar_sessions s join public.icash_webinars w on w.id=s.webinar_id where s.id=p_session and s.visitor_id=p_visitor and not s.is_preview and w.parent_webinar_id is null) then return;end if;
 update public.icash_webinar_visitors set
  consent_version=case when p_email_consent and email_consent_at is not null then 'webinar-email-ongoing-2026-10-09' else consent_version end,
  sms_consent_version=case when p_sms_consent and sms_consent_at is not null then 'webinar-sms-ongoing-2026-10-09' else sms_consent_version end
 where id=p_visitor;
 -- A repeated opt-in can extend consent without restarting or duplicating the sequence.
 update public.icash_webinar_campaigns c set consent_version=case when c.channel='email' then v.consent_version else v.sms_consent_version end
 from public.icash_webinar_visitors v where c.visitor_id=p_visitor and v.id=c.visitor_id
 and (c.channel='email' and p_email_consent and c.recipient=lower(v.email) and v.opted_out_at is null
   or c.channel='sms' and p_sms_consent and c.recipient=v.phone and v.sms_opted_out_at is null and v.sms_replied_at is null);
end $$;

create or replace function public.icash_webinar_claim_followups(p_email_ready boolean,p_sms_ready boolean) returns setof public.icash_webinar_outbox
language plpgsql security invoker set search_path='' as $$
begin
 -- Queue only the current week, never a backlog. Texts start three days after
 -- the weekly email cadence; final authorization still enforces all frequency limits.
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination)
 select c.visitor_id,c.session_id,c.channel,c.recipient,1000+cycle.week,
  now(),now()+interval '2 days',c.id,case when cycle.week%2=0 then 'webinar' else 'checkout' end
 from public.icash_webinar_campaigns c join public.icash_webinar_visitors v on v.id=c.visitor_id
 cross join lateral (select floor(extract(epoch from(now()-c.started_at-case when c.channel='sms' then interval '63 days' else interval '60 days' end))/604800)::integer as week) cycle
 where cycle.week>=0 and not public.icash_webinar_has_paid(v.id)
 and (
  c.channel='email' and p_email_ready and v.email_consent_at is not null and v.opted_out_at is null and lower(v.email)=c.recipient
  and not exists(select 1 from public.icash_webinar_suppressions s where s.email=c.recipient)
  and (c.consent_version='webinar-email-ongoing-2026-10-09' and v.consent_version=c.consent_version
    or c.consent_version='webinar-email-campaign-2026-10-08' and v.last_seen_at>now()-interval '90 days')
  or c.channel='sms' and p_sms_ready and c.consent_version='webinar-sms-ongoing-2026-10-09' and v.sms_consent_version=c.consent_version
  and v.sms_consent_at is not null and v.sms_opted_out_at is null and v.sms_replied_at is null and v.phone=c.recipient
  and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=c.recipient)
  and not exists(select 1 from public.icash_text_suppressions s where s.phone=c.recipient)
 ) on conflict do nothing;
 update public.icash_webinar_outbox set state='unknown',last_error='Delivery unconfirmed; not retried' where channel='sms' and state='sending' and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox set state='failed',last_error='Retry window ended' where (state='pending' or (state in ('claimed','sending') and claimed_at<now()-interval '5 minutes')) and (attempts>=4 or first_attempt_at<now()-interval '20 hours');
 update public.icash_webinar_outbox set state='pending' where (state='claimed' or (state='sending' and channel='email')) and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox f set state='canceled' where state in ('pending','claimed') and (not public.icash_webinar_followup_allowed(f.id) or case when campaign_id is null then created_at<now()-interval '7 days' else expires_at<now() end);
 return query with candidates as (
  select f.id from public.icash_webinar_outbox f join public.icash_webinar_visitors v on v.id=f.visitor_id
  where f.state='pending' and f.due_at<=now() and v.last_seen_at<=now()-interval '15 minutes'
  and ((f.channel='email' and p_email_ready) or (f.channel='sms' and p_sms_ready))
  order by f.due_at for update of f skip locked limit 25
 ) update public.icash_webinar_outbox f set state='claimed',claimed_at=now(),attempts=attempts+1 from candidates c where f.id=c.id returning f.*;
end $$;
-- The updated opt-in still includes the existing post-purchase customer updates.
do $$ declare body text;begin
 select pg_get_functiondef('public.icash_webinar_activate_customers()'::regprocedure) into strict body;
 if position('=''webinar-email-campaign-2026-10-08''' in body)=0 or position('=''webinar-sms-campaign-2026-10-08''' in body)=0 then raise exception 'Customer lifecycle prerequisite changed';end if;
 body:=replace(body,'=''webinar-email-campaign-2026-10-08''',' in (''webinar-email-campaign-2026-10-08'',''webinar-email-ongoing-2026-10-09'')');
 body:=replace(body,'=''webinar-sms-campaign-2026-10-08''',' in (''webinar-sms-campaign-2026-10-08'',''webinar-sms-ongoing-2026-10-09'')');
 execute body;
end $$;
revoke all on function public.icash_webinar_contact_ongoing_campaign(uuid,uuid,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.icash_webinar_contact_ongoing_campaign(uuid,uuid,text,text,text,boolean,boolean) to service_role;
commit;
