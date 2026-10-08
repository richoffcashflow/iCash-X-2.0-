-- A shared acquisition campaign. Existing limited SMS consent is never upgraded.
alter table public.icash_webinar_outbox drop constraint icash_webinar_outbox_step_check;
alter table public.icash_webinar_outbox add constraint icash_webinar_outbox_step_check check(step>=0);
create table public.icash_webinar_campaigns(
 id uuid primary key default gen_random_uuid(), visitor_id uuid not null references public.icash_webinar_visitors(id),
 session_id uuid not null references public.icash_webinar_sessions(id),channel text not null check(channel in ('email','sms')),
 recipient text not null,started_at timestamptz not null default now(),consent_version text not null,
 unique(channel,recipient)
);
alter table public.icash_webinar_outbox add column campaign_id uuid references public.icash_webinar_campaigns(id),
 add column expires_at timestamptz,
 add column destination text not null default 'smart' check(destination in ('smart','webinar','checkout'));
create index icash_webinar_outbox_campaign on public.icash_webinar_outbox(campaign_id,step);
create index icash_webinar_campaigns_visitor on public.icash_webinar_campaigns(visitor_id);
create index icash_webinar_campaigns_session on public.icash_webinar_campaigns(session_id);
create table public.icash_webinar_text_senders(phone text primary key check(phone~'^\+[1-9][0-9]{7,14}$'),enabled boolean not null default true,verified_at timestamptz not null default now());
create table public.icash_webinar_text_assignments(recipient text primary key,sender text not null references public.icash_webinar_text_senders(phone));
create index icash_webinar_text_assignments_sender on public.icash_webinar_text_assignments(sender);
insert into public.icash_webinar_text_senders(phone) select phone from public.icash_text_senders where enabled on conflict do nothing;
do $$ declare t text;begin
 foreach t in array array['icash_webinar_campaigns','icash_webinar_text_senders','icash_webinar_text_assignments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.icash_webinar_campaign_steps() returns table(step integer,channel text,delay_minutes integer,destination text)
language sql immutable security invoker set search_path='' as $$
 with schedule as (
 select 'email'::text ch, d*1440+20 mins,case when d%2=0 then 'smart' else 'webinar' end dest from generate_series(0,6) d
 union all select 'email',d*1440+480,'checkout' from generate_series(0,2) d
 union all select 'sms',d*1440+240,case when d in (0,4) then 'smart' else 'checkout' end from unnest(array[0,1,2,4,6]) d
 union all select 'email',d*1440+20,case when d%4=0 then 'webinar' else 'checkout' end from generate_series(8,28,2) d
 union all select 'sms',d*1440+240,'checkout' from unnest(array[10,17,24]) d
 union all select 'email',d*1440+20,case when d%2=0 then 'webinar' else 'checkout' end from generate_series(30,57,3) d
 union all select 'sms',d*1440+240,'webinar' from unnest(array[31,45]) d
 ) select (99+row_number() over(order by mins,ch))::integer,ch,mins,dest from schedule;
$$;
-- The old seven-argument function remains available to already-open clients.
create function public.icash_webinar_contact_campaign(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.icash_webinar_visitors; c public.icash_webinar_campaigns; ch text; recipient text;
begin
 perform public.icash_webinar_contact_followups(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);
 select * into v from public.icash_webinar_visitors where id=p_visitor for update;
 if not found or not exists(select 1 from public.icash_webinar_sessions s join public.icash_webinars w on w.id=s.webinar_id where s.id=p_session and s.visitor_id=p_visitor and not s.is_preview and w.parent_webinar_id is null) then return;end if;
 update public.icash_webinar_visitors set consent_version=case when p_email_consent then 'webinar-email-campaign-2026-10-08' else consent_version end,
 sms_consent_version=case when p_sms_consent then 'webinar-sms-campaign-2026-10-08' else sms_consent_version end where id=p_visitor;
 -- Replace pending short reminders only for the contact that chose the new campaign.
 update public.icash_webinar_outbox set state='canceled' where visitor_id=p_visitor and campaign_id is null and state in ('pending','claimed');
 if public.icash_webinar_has_paid(p_visitor) then return;end if;
 foreach ch in array array['email','sms'] loop
 recipient:=case when ch='email' then lower(v.email) else v.phone end;
 if (ch='email' and p_email_consent and v.opted_out_at is null) or (ch='sms' and p_sms_consent and v.sms_opted_out_at is null and v.sms_replied_at is null) then
 if recipient is null or recipient='' then continue;end if;
 insert into public.icash_webinar_campaigns(visitor_id,session_id,channel,recipient,consent_version)
 values(p_visitor,p_session,ch,recipient,case when ch='email' then 'webinar-email-campaign-2026-10-08' else 'webinar-sms-campaign-2026-10-08' end) on conflict do nothing returning * into c;
 if c.id is not null then
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination)
 select p_visitor,p_session,ch,recipient,s.step,c.started_at+make_interval(mins=>s.delay_minutes),c.started_at+make_interval(mins=>s.delay_minutes)+interval '2 days',c.id,s.destination from public.icash_webinar_campaign_steps() s where s.channel=ch on conflict do nothing;
 end if;end if;end loop;
 update public.icash_webinar_outbox f set state='canceled' where visitor_id=p_visitor and state in ('pending','claimed') and not public.icash_webinar_followup_allowed(f.id);
end $$;
create function public.icash_webinar_campaign_sender(p_recipient text) returns text language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 if p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 select a.sender into chosen from public.icash_webinar_text_assignments a where a.recipient=p_recipient;
 if chosen is not null then
 -- Pausing a sender pauses its conversations instead of changing their identity.
 return case when exists(select 1 from public.icash_webinar_text_senders where phone=chosen and enabled) then chosen else null end;
 end if;
 select s.phone into chosen from public.icash_webinar_text_senders s left join public.icash_webinar_text_assignments a on a.sender=s.phone where s.enabled group by s.phone order by count(a.recipient),s.phone limit 1;
 if chosen is not null then insert into public.icash_webinar_text_assignments(recipient,sender) values(p_recipient,chosen);end if;
 return chosen;
end $$;
create or replace function public.icash_webinar_claim_followups(p_email_ready boolean,p_sms_ready boolean) returns setof public.icash_webinar_outbox language plpgsql security invoker set search_path='' as $$
begin
 -- Continue with one weekly email for engaged non-buyers. A delayed worker never backfills old weeks.
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination)
 select c.visitor_id,c.session_id,c.channel,c.recipient,1000+floor(extract(epoch from(now()-c.started_at-interval '60 days'))/604800)::integer,
 now(),now()+interval '2 days',c.id,case when floor(extract(epoch from(now()-c.started_at-interval '60 days'))/604800)::integer%2=0 then 'webinar' else 'checkout' end
 from public.icash_webinar_campaigns c join public.icash_webinar_visitors v on v.id=c.visitor_id
 where p_email_ready and c.channel='email' and c.started_at<=now()-interval '60 days' and v.last_seen_at>now()-interval '90 days'
 and v.email_consent_at is not null and v.opted_out_at is null and lower(v.email)=c.recipient and not public.icash_webinar_has_paid(v.id)
 and not exists(select 1 from public.icash_webinar_suppressions s where s.email=c.recipient)
 on conflict do nothing;
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
create or replace function public.icash_webinar_authorize_followup(p_id uuid,p_payload jsonb) returns public.icash_webinar_outbox language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox; v public.icash_webinar_visitors; config jsonb; recent integer; channel_recent integer; identity text; candidate jsonb; local_hour integer;
begin
 select * into f from public.icash_webinar_outbox where id=p_id for update;
 if not found or f.state<>'claimed' then return null;end if;
 select * into v from public.icash_webinar_visitors where id=f.visitor_id;
 -- Shared contact locks prevent separate browser identities from doubling frequency.
 for identity in select distinct value from unnest(array['visitor:'||v.id::text,'email:'||lower(v.email),'phone:'||v.phone]) value where value is not null order by value loop
 perform pg_advisory_xact_lock(hashtextextended(identity,815));end loop;
 select s.config into config from public.icash_webinar_settings s where id=1;
 if not public.icash_webinar_followup_allowed(f.id) then update public.icash_webinar_outbox set state='canceled' where id=f.id;return null;end if;
 if not coalesce((config->>case when f.channel='email' then 'enabled' else 'smsEnabled' end)::boolean,false) or v.last_seen_at>now()-interval '15 minutes' then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '20 minutes',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.campaign_id is not null then
 begin local_hour:=extract(hour from now() at time zone v.timezone);exception when invalid_parameter_value then local_hour:=0;end;
 if local_hour<9 or local_hour>=20 then update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 end if;
 select count(*),count(*) filter(where x.channel=f.channel) into recent,channel_recent from public.icash_webinar_outbox x
 where x.id<>f.id and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone)
 and (x.sent_at>now()-interval '24 hours' or x.state in ('sending','unknown') and x.first_attempt_at>now()-interval '24 hours');
 if recent>=(case when f.campaign_id is null then 2 else 3 end)
 or f.campaign_id is not null and channel_recent>=(case when f.channel='sms' then 1 else 2 end)
 or exists(select 1 from public.icash_webinar_outbox x where x.id<>f.id and (x.visitor_id=v.id or x.channel='email' and x.recipient=lower(v.email) or x.channel='sms' and x.recipient=v.phone) and (x.sent_at>now()-case when f.campaign_id is null then interval '1 hour' else interval '3 hours' end or x.state='sending' or x.state='unknown' and x.first_attempt_at>now()-interval '3 hours')) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 candidate:=coalesce(f.payload,p_payload);
 if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>16000 then raise exception 'Invalid follow-up content';end if;
 if f.campaign_id is not null and f.channel='sms' and not exists(select 1 from public.icash_webinar_text_assignments a join public.icash_webinar_text_senders s on s.phone=a.sender where a.recipient=f.recipient and s.enabled and s.phone=candidate->>'from') then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 update public.icash_webinar_outbox set state='sending',payload=candidate,first_attempt_at=coalesce(first_attempt_at,now()),claimed_at=now() where id=f.id returning * into f;
 return f;
end $$;
do $$ declare signature text;begin
 foreach signature in array array['icash_webinar_campaign_steps()','icash_webinar_contact_campaign(uuid,uuid,text,text,text,boolean,boolean)','icash_webinar_campaign_sender(text)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';execute 'grant execute on function public.'||signature||' to service_role';end loop;
end $$;
