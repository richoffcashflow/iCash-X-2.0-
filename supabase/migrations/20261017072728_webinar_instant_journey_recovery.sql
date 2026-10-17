begin;
-- Event-based, finite recovery. Historical opt-ins are not upgraded to a faster cadence.
create table public.icash_webinar_recovery_presence(
 page_id uuid primary key,visitor_id uuid not null references public.icash_webinar_visitors(id),session_id uuid not null references public.icash_webinar_sessions(id),
 sequence bigint not null,stage text not null check(stage in ('webinar','checkout','vip')),state text not null check(state in ('active','left','handoff','payment')),
 seen_at timestamptz not null default now(),hold_until timestamptz not null default now()
);
create index icash_webinar_recovery_presence_visitor on public.icash_webinar_recovery_presence(visitor_id,hold_until);
create table public.icash_webinar_recoveries(
 id uuid primary key default gen_random_uuid(),visitor_id uuid not null references public.icash_webinar_visitors(id),session_id uuid not null references public.icash_webinar_sessions(id),
 kind text not null check(kind in ('webinar','checkout','vip')),membership_id uuid references public.icash_memberships(id),
 started_at timestamptz not null default now(),ended_at timestamptz,unique(visitor_id,kind),unique(membership_id)
);
alter table public.icash_webinar_outbox add column recovery_id uuid references public.icash_webinar_recoveries(id);
create index icash_webinar_outbox_recovery on public.icash_webinar_outbox(recovery_id,step);
alter table public.icash_webinar_outbox drop constraint icash_webinar_outbox_destination_check;
alter table public.icash_webinar_outbox add constraint icash_webinar_outbox_destination_check check(destination in ('smart','webinar','checkout','vip'));
do $$ declare t text;begin foreach t in array array['icash_webinar_recovery_presence','icash_webinar_recoveries'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;

create function public.icash_webinar_contact_lock(p_visitor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare identity text;v public.icash_webinar_visitors;begin
 select * into v from public.icash_webinar_visitors where id=p_visitor;
 for identity in select distinct value from unnest(array['visitor:'||v.id::text,'email:'||lower(v.email),'phone:'||v.phone]) value where value is not null order by value loop
 perform pg_advisory_xact_lock(hashtextextended(identity,815));end loop;
end $$;
create function public.icash_webinar_same_contact(p_one uuid,p_two uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_webinar_visitors a join public.icash_webinar_visitors b on a.id=b.id or lower(a.email)=lower(b.email) or a.phone=b.phone where a.id=p_one and b.id=p_two);
$$;
-- This schedule is for owner previews; contact registration alone never schedules a recovery.
create or replace function public.icash_webinar_return_steps() returns table(step integer,channel text,delay_minutes integer,destination text)
language sql immutable security invoker set search_path='' as $$
 select k.base+n.i,c.ch,n.i*15,k.dest from (values(400000,'webinar'::text),(400010,'checkout'),(400020,'vip')) k(base,dest)
 cross join (values(0),(1)) n(i) cross join (values('email'::text),('sms')) c(ch);
$$;
create or replace function public.icash_webinar_campaign_steps() returns table(step integer,channel text,delay_minutes integer,destination text)
language sql immutable security invoker set search_path='' as $$ select * from public.icash_webinar_return_steps() where false; $$;
-- Older pages preserve their receipt without reserving the new recovery step IDs.
create or replace function public.icash_webinar_contact_ongoing_campaign(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin perform public.icash_webinar_contact_before_return_campaign(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);end $$;
-- The historical enrollment functions remain callable for already-open pages.
-- Their old jobs cannot dispatch under the new worker.
create function public.icash_webinar_contact_recovery(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_webinar_contact_before_return_campaign(p_visitor,p_session,p_name,p_email,p_phone,p_email_consent,p_sms_consent);
 if not exists(select 1 from public.icash_webinar_sessions s join public.icash_webinars w on w.id=s.webinar_id where s.id=p_session and s.visitor_id=p_visitor and not s.is_preview and w.parent_webinar_id is null) then return;end if;
 update public.icash_webinar_visitors set consent_version=case when p_email_consent and email_consent_at is not null then 'webinar-email-recovery-2026-10-17' else consent_version end,
 sms_consent_version=case when p_sms_consent and sms_consent_at is not null then 'webinar-sms-recovery-2026-10-17' else sms_consent_version end where id=p_visitor;
 update public.icash_webinar_campaigns c set consent_version=case when c.channel='email' then v.consent_version else v.sms_consent_version end
 from public.icash_webinar_visitors v where v.id=p_visitor and c.visitor_id=v.id and (c.channel='email' and p_email_consent or c.channel='sms' and p_sms_consent);
 update public.icash_webinar_outbox set state='canceled' where visitor_id=p_visitor and recovery_id is null and reply_event_id is null and state in ('pending','claimed') and first_attempt_at is null;
end $$;
update public.icash_webinar_outbox set state='canceled',last_error='Replaced by event-based recovery' where recovery_id is null and reply_event_id is null and state in ('pending','claimed') and first_attempt_at is null;

create function public.icash_webinar_queue_recovery(p_visitor uuid,p_session uuid,p_kind text,p_membership uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.icash_webinar_recoveries;v public.icash_webinar_visitors;ch text;recipient_address text;c uuid;base integer;
begin
 if p_kind not in ('webinar','checkout','vip') then return null;end if;
 perform public.icash_webinar_contact_lock(p_visitor);
 select * into v from public.icash_webinar_visitors where id=p_visitor;
 if not found or not exists(select 1 from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor and not is_preview) then return null;end if;
 if p_kind<>'vip' and (public.icash_webinar_has_paid(p_visitor) or exists(select 1 from public.icash_webinar_recovery_presence p where public.icash_webinar_same_contact(p.visitor_id,p_visitor) and p.hold_until>now() and p.state<>'left')) then return null;end if;
 if p_kind='webinar' and (exists(select 1 from public.icash_webinar_recovery_presence p where public.icash_webinar_same_contact(p.visitor_id,p_visitor) and p.stage='checkout') or exists(select 1 from public.icash_webinar_recoveries prior where public.icash_webinar_same_contact(prior.visitor_id,p_visitor) and prior.kind in ('checkout','vip'))) then return null;end if;
 if p_kind='vip' and not exists(select 1 from public.icash_memberships m where m.id=p_membership and m.mode='live' and m.state='active' and m.paid_through>now() and (m.vip_until is null or m.vip_until<=now())
 and (m.guest_hash=v.funding_guest_hash or m.account_id=v.account_id) and m.post_purchase_webinar_id is not null and exists(select 1 from public.icash_membership_invoices i where i.membership_id=m.id)) then return null;end if;
 if p_kind='vip' and exists(select 1 from public.icash_webinar_sessions s join public.icash_memberships m on m.id=p_membership and m.post_purchase_webinar_id=s.webinar_id where not s.is_preview and public.icash_webinar_same_contact(s.visitor_id,p_visitor)) then return null;end if;
 -- Only a fresh receipt authorizes instant/15-minute reminders at any hour.
 if coalesce(v.consent_version,'')<>'webinar-email-recovery-2026-10-17' and coalesce(v.sms_consent_version,'')<>'webinar-sms-recovery-2026-10-17' then return null;end if;
 insert into public.icash_webinar_recoveries(visitor_id,session_id,kind,membership_id) values(p_visitor,p_session,p_kind,p_membership) on conflict do nothing returning * into r;
 if r.id is null then return null;end if;
 base:=case p_kind when 'webinar' then 400000 when 'checkout' then 400010 else 400020 end;
 foreach ch in array array['sms','email'] loop
 recipient_address:=case when ch='email' then lower(v.email) else v.phone end;
 if recipient_address is null or ch='email' and (v.email_consent_at is null or v.opted_out_at is not null or v.consent_version is distinct from 'webinar-email-recovery-2026-10-17')
 or ch='sms' and (v.sms_consent_at is null or v.sms_opted_out_at is not null or v.sms_replied_at is not null or v.sms_consent_version is distinct from 'webinar-sms-recovery-2026-10-17') then continue;end if;
 select id into c from public.icash_webinar_campaigns where channel=ch and icash_webinar_campaigns.recipient=recipient_address;
 if c is null then continue;end if;
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination,recovery_id)
 select v.id,p_session,ch,recipient_address,base+n,case when n=0 then now() else 'infinity'::timestamptz end,now()+interval '1 day',c,p_kind,r.id from generate_series(0,1) n on conflict do nothing;
 end loop;
 return r.id;
end $$;

create function public.icash_webinar_record_presence(p_visitor uuid,p_session uuid,p_page uuid,p_sequence bigint,p_stage text,p_state text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare s public.icash_webinar_sessions;stage text;begin
 select * into s from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor and not is_preview;
 if not found or p_sequence<1 or p_state not in ('active','left','handoff','payment') or p_stage not in ('webinar','checkout','vip') then return false;end if;
 perform public.icash_webinar_contact_lock(p_visitor);
 stage:=case when s.config->>'parentWebinarId' is not null then 'vip' when p_stage='checkout' then 'checkout' else 'webinar' end;
 insert into public.icash_webinar_recovery_presence(page_id,visitor_id,session_id,sequence,stage,state,hold_until)
 values(p_page,p_visitor,p_session,p_sequence,stage,p_state,now()+case when p_state='payment' then interval '15 minutes' when p_state='handoff' then interval '30 seconds' when p_state='active' then interval '2 minutes' else interval '0 seconds' end)
 on conflict(page_id) do update set session_id=excluded.session_id,sequence=excluded.sequence,stage=excluded.stage,state=excluded.state,seen_at=now(),hold_until=excluded.hold_until
 where icash_webinar_recovery_presence.visitor_id=p_visitor and icash_webinar_recovery_presence.sequence<p_sequence;
 if not found then return false;end if;
 if p_state='active' then
 update public.icash_webinar_visitors set last_seen_at=now() where id=p_visitor;
 update public.icash_webinar_recovery_presence set state='left',hold_until=now() where page_id<>p_page and state='handoff' and public.icash_webinar_same_contact(visitor_id,p_visitor);
 -- Returning ends the pair; repeated exits cannot start another pair.
 update public.icash_webinar_recoveries r set ended_at=coalesce(ended_at,now()) where public.icash_webinar_same_contact(r.visitor_id,p_visitor) and (r.kind<>'vip' or stage='vip');
 update public.icash_webinar_outbox f set state='canceled',last_error='Viewer returned or advanced' from public.icash_webinar_recoveries r where f.recovery_id=r.id and r.ended_at is not null and public.icash_webinar_same_contact(r.visitor_id,p_visitor) and f.state in ('pending','claimed');
 end if;
 if p_state='left' and stage<>'vip' then perform public.icash_webinar_queue_recovery(p_visitor,p_session,stage);end if;
 return true;
end $$;

create function public.icash_webinar_paid_recovery() returns trigger language plpgsql security invoker set search_path='' as $$
declare source_session public.icash_webinar_sessions;begin
 if new.mode<>'live' or new.state<>'active' or new.paid_through is null or (old.paid_through is not null and old.state='active') then return new;end if;
 for source_session in select s.* from public.icash_webinar_sessions s join public.icash_webinar_visitors v on v.id=s.visitor_id where not s.is_preview and s.config->>'parentWebinarId' is null
 and (v.funding_guest_hash=new.guest_hash or v.account_id=new.account_id) order by s.created_at desc limit 10 loop
 perform public.icash_webinar_queue_recovery(source_session.visitor_id,source_session.id,'vip',new.id);end loop;
 return new;
end $$;
create trigger icash_webinar_paid_recovery after update of paid_through,state on public.icash_memberships for each row execute function public.icash_webinar_paid_recovery();

create function public.icash_webinar_recovery_valid(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select r.ended_at is null and r.started_at>now()-interval '1 day' and case when r.kind='vip' then
 exists(select 1 from public.icash_memberships m join public.icash_webinars w on w.id=m.post_purchase_webinar_id where m.id=r.membership_id and m.mode='live' and m.state='active' and m.paid_through>now() and (m.vip_until is null or m.vip_until<=now())
 and w.parent_webinar_id is not null and w.config->>'status'='published' and (coalesce(w.config->>'videoUrl','')<>'' or coalesce(w.config->'nightVersion'->>'videoUrl','')<>'')
 and not exists(select 1 from public.icash_webinar_sessions s where s.webinar_id=w.id and not s.is_preview and public.icash_webinar_same_contact(s.visitor_id,r.visitor_id)))
 else not public.icash_webinar_has_paid(r.visitor_id) and not exists(select 1 from public.icash_webinar_recovery_presence p where public.icash_webinar_same_contact(p.visitor_id,r.visitor_id) and p.state<>'left' and p.hold_until>now()) end
 from public.icash_webinar_recoveries r where r.id=p_id),false);
$$;
alter function public.icash_webinar_followup_allowed(uuid) rename to icash_webinar_followup_allowed_before_recovery;
create function public.icash_webinar_followup_allowed(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select case when f.recovery_id is null then f.reply_event_id is not null and public.icash_webinar_followup_allowed_before_recovery(f.id)
 else (case when f.reply_event_id is not null then exists(select 1 from public.icash_webinar_recoveries r join public.icash_memberships m on m.id=r.membership_id join public.icash_webinars w on w.id=m.post_purchase_webinar_id where r.id=f.recovery_id and m.mode='live' and m.state='active' and m.paid_through>now() and (m.vip_until is null or m.vip_until<=now()) and w.config->>'status'='published') else public.icash_webinar_recovery_valid(f.recovery_id) end) and case when f.channel='email' then
 v.consent_version='webinar-email-recovery-2026-10-17' and v.email_consent_at is not null and v.opted_out_at is null and lower(v.email)=f.recipient and not exists(select 1 from public.icash_webinar_suppressions where email=f.recipient)
 else v.sms_consent_version='webinar-sms-recovery-2026-10-17' and v.sms_consent_at is not null and v.sms_opted_out_at is null and v.sms_replied_at is null and v.phone=f.recipient
 and not exists(select 1 from public.icash_webinar_phone_suppressions where phone=f.recipient) and not exists(select 1 from public.icash_text_suppressions where phone=f.recipient) end end
 from public.icash_webinar_outbox f join public.icash_webinar_visitors v on v.id=f.visitor_id where f.id=p_id),false);
$$;
-- Preserve historical callers while the worker gains a targeted immediate dispatch.
drop function public.icash_webinar_claim_followups(boolean,boolean);
create function public.icash_webinar_claim_followups(p_email_ready boolean,p_sms_ready boolean,p_visitor uuid default null) returns setof public.icash_webinar_outbox
language plpgsql security invoker set search_path='' as $$
declare stale public.icash_webinar_recovery_presence;begin
 delete from public.icash_webinar_recovery_presence where seen_at<now()-interval '7 days';
 -- Lost close beacons have a bounded heartbeat fallback; never infer a departure from signup alone.
 for stale in select distinct on (p.visitor_id) p.* from public.icash_webinar_recovery_presence p where p.stage<>'vip' and not public.icash_webinar_has_paid(p.visitor_id) and exists(select 1 from public.icash_webinar_visitors v where v.id=p.visitor_id and (v.consent_version='webinar-email-recovery-2026-10-17' or v.sms_consent_version='webinar-sms-recovery-2026-10-17')) and p.hold_until<=now() and p.seen_at>now()-interval '1 day' and (p_visitor is null or p.visitor_id=p_visitor)
 and not exists(select 1 from public.icash_webinar_recoveries r where r.visitor_id=p.visitor_id and r.kind=p.stage)
 order by p.visitor_id,(p.stage='checkout') desc,p.seen_at desc limit 100 loop
 perform public.icash_webinar_queue_recovery(stale.visitor_id,stale.session_id,stale.stage);end loop;
 update public.icash_webinar_outbox set state='unknown',last_error='Delivery unconfirmed; not retried' where channel='sms' and state='sending' and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox set state='failed',last_error='Retry window ended' where (state='pending' or state in ('claimed','sending') and claimed_at<now()-interval '5 minutes') and (attempts>=4 or first_attempt_at<now()-interval '20 hours');
 update public.icash_webinar_outbox set state='pending' where (state='claimed' or state='sending' and channel='email') and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox f set state='canceled' where state in ('pending','claimed') and (not public.icash_webinar_followup_allowed(f.id) or coalesce(expires_at,created_at+interval '1 day')<=now());
 return query with candidates as (
 select f.id from public.icash_webinar_outbox f where f.state='pending' and f.due_at<=now() and (p_visitor is null or f.visitor_id=p_visitor)
 and ((f.channel='email' and p_email_ready) or (f.channel='sms' and p_sms_ready))
 order by (f.reply_event_id is not null) desc,f.due_at,(f.channel='sms') desc,f.id for update of f skip locked limit 25
 ) update public.icash_webinar_outbox f set state='claimed',claimed_at=now(),attempts=attempts+1 from candidates c where f.id=c.id returning f.*;
end $$;

create or replace function public.icash_webinar_authorize_followup(p_id uuid,p_payload jsonb) returns public.icash_webinar_outbox
language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox;v public.icash_webinar_visitors;config jsonb;candidate jsonb;begin
 select * into f from public.icash_webinar_outbox where id=p_id;
 if not found then return null;end if;
 perform public.icash_webinar_contact_lock(f.visitor_id);
 select * into f from public.icash_webinar_outbox where id=p_id for update;
 if f.state<>'claimed' or f.due_at>now() then return null;end if;
 select * into v from public.icash_webinar_visitors where id=f.visitor_id;
 select s.config into config from public.icash_messaging_settings s where id=1;
 if not public.icash_webinar_followup_allowed(f.id) or coalesce(f.expires_at,f.created_at+interval '1 day')<=now() or f.first_attempt_at<now()-interval '20 hours' then
 update public.icash_webinar_outbox set state='canceled' where id=f.id;return null;end if;
 if not coalesce((config->>case when f.channel='email' then 'enabled' else 'smsEnabled' end)::boolean,false) then
 update public.icash_webinar_outbox set state='pending',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 -- No quiet-hour, daily or hourly delay for this explicitly requested instant sequence.
 -- Each opportunity uses one channel, including unknown outcomes and other browser identities.
 if f.first_attempt_at is null and f.recovery_id is not null and f.reply_event_id is null and exists(select 1 from public.icash_webinar_outbox x where x.id<>f.id and x.step=f.step and x.first_attempt_at is not null and public.icash_webinar_same_contact(x.visitor_id,v.id)) then
 update public.icash_webinar_outbox set state='canceled',last_error='Reminder already attempted on one channel' where id=f.id;return null;end if;
 candidate:=coalesce(f.payload,p_payload);
 if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>16000 then raise exception 'Invalid follow-up content';end if;
 if f.channel='email' and coalesce(trim(config->>'postalAddress'),'')='' then
 update public.icash_webinar_outbox set state='pending',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.channel='sms' then
 perform pg_advisory_xact_lock(818,1);
 if not exists(select 1 from public.icash_webinar_text_assignments a join public.icash_webinar_text_senders s on s.phone=a.sender where a.recipient=f.recipient and s.enabled and s.phone=candidate->>'from')
 or exists(select 1 from public.icash_text_threads where sender=candidate->>'from' and recipient=f.recipient and retired_at is null) then
 update public.icash_webinar_outbox set state='pending',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;end if;
 update public.icash_webinar_outbox set state='sending',payload=candidate,first_attempt_at=coalesce(first_attempt_at,now()),claimed_at=now() where id=f.id returning * into f;
 return f;
end $$;
-- The second message starts 15 minutes after the first accepted send, never signup or a failed attempt.
alter function public.icash_webinar_finish_followup(uuid,text) rename to icash_webinar_finish_followup_before_recovery;
create function public.icash_webinar_finish_followup(p_id uuid,p_provider text) returns void language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox;begin
 perform public.icash_webinar_finish_followup_before_recovery(p_id,p_provider);
 select * into f from public.icash_webinar_outbox where id=p_id;
 if f.recovery_id is not null and f.step in (400000,400010,400020) and f.sent_at is not null then
 update public.icash_webinar_outbox set due_at=f.sent_at+interval '15 minutes',expires_at=least(expires_at,f.sent_at+interval '1 hour') where recovery_id=f.recovery_id and step=f.step+1 and state='pending' and due_at='infinity'::timestamptz;
 end if;
end $$;
-- Narrow capability: a delivered reminder can reopen only its purchased VIP video.
create function public.icash_webinar_vip_link(p_job uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('visitor_id',r.visitor_id,'webinar_id',w.id,'public_code',w.public_code,'mode',m.mode,'state',m.state,'paid_through',m.paid_through,'vip_until',m.vip_until,'post_purchase_webinar_id',m.post_purchase_webinar_id)
 from public.icash_webinar_outbox f join public.icash_webinar_recoveries r on r.id=f.recovery_id join public.icash_memberships m on m.id=r.membership_id join public.icash_webinars w on w.id=m.post_purchase_webinar_id
 where f.id=p_job and r.kind='vip' and f.first_attempt_at>now()-interval '30 days' and m.mode='live' and m.state='active' and m.paid_through>now() and w.parent_webinar_id is not null and w.config->>'status'='published';
$$;
-- A reply asking to join gets the relevant link, including a paid buyer's VIP.
create or replace function public.icash_webinar_queue_return(p_event text,p_channel text,p_recipient text,p_body text) returns text
language plpgsql security invoker set search_path='' as $$
declare c public.icash_webinar_campaigns;v public.icash_webinar_visitors;intent text;outcome text;r public.icash_webinar_recoveries;dest text:='webinar';begin
 perform pg_advisory_xact_lock(hashtextextended('webinar-reply:'||p_channel||':'||p_recipient,821));
 select e.outcome into outcome from public.icash_webinar_reply_events e where event_id=p_event;if found then return outcome;end if;
 select * into c from public.icash_webinar_campaigns where channel=p_channel and recipient=p_recipient;if not found then return 'ignored';end if;
 select * into v from public.icash_webinar_visitors where id=c.visitor_id;
 perform public.icash_webinar_contact_lock(v.id);
 intent:=public.icash_webinar_reply_intent(p_body);outcome:=case when intent='stop' then 'stopped' else 'review' end;
 insert into public.icash_webinar_reply_events(event_id,channel,recipient,body,outcome) values(p_event,p_channel,p_recipient,left(p_body,4000),outcome);
 -- A response stops automatic nudges on both channels, including support and STOP.
 update public.icash_webinar_outbox set state='canceled' where public.icash_webinar_same_contact(visitor_id,v.id) and reply_event_id is null and state in ('pending','claimed');
 if intent='stop' then
 if p_channel='sms' then perform public.icash_webinar_text_reply(p_recipient,true);else perform public.icash_webinar_unsubscribe(v.id,'unsubscribe');end if;return outcome;end if;
 if intent<>'return' then return outcome;end if;
 if p_channel='sms' and (v.phone is distinct from p_recipient or v.sms_consent_at is null or v.sms_opted_out_at is not null or exists(select 1 from public.icash_text_suppressions where phone=p_recipient) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p_recipient)) then return outcome;end if;
 if p_channel='email' and (lower(v.email) is distinct from p_recipient or v.email_consent_at is null or v.opted_out_at is not null or exists(select 1 from public.icash_webinar_suppressions where email=p_recipient)) then return outcome;end if;
 if public.icash_webinar_has_paid(v.id) then
 select r1.* into r from public.icash_webinar_recoveries r1 join public.icash_memberships m on m.id=r1.membership_id
 where r1.kind='vip' and public.icash_webinar_same_contact(r1.visitor_id,v.id) and m.mode='live' and m.state='active' and m.paid_through>now() and (m.vip_until is null or m.vip_until<=now()) order by r1.started_at desc limit 1;
 if r.id is null then return outcome;end if;dest:='vip';end if;
 if exists(select 1 from public.icash_webinar_outbox where channel=p_channel and recipient=p_recipient and reply_event_id is not null and (state in ('pending','claimed','sending') or first_attempt_at>now()-interval '1 minute')) then
 update public.icash_webinar_reply_events set outcome='ignored' where event_id=p_event;return 'ignored';end if;
 if p_channel='sms' then update public.icash_webinar_visitors set sms_replied_at=null where id=v.id;end if;
 -- A requested join link supersedes automatic nudges and never revives them.
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at,expires_at,campaign_id,destination,reply_event_id,recovery_id)
 values(v.id,coalesce(r.session_id,c.session_id),p_channel,p_recipient,nextval('public.icash_webinar_reply_steps')::integer,now(),now()+interval '1 hour',c.id,dest,p_event,r.id);
 update public.icash_webinar_reply_events set outcome='queued' where event_id=p_event;return 'queued';
end $$;
do $$ declare body text;begin
 select pg_get_functiondef('public.icash_route_lifecycle_text(jsonb,boolean)'::regprocedure) into strict body;
 if position('if role_name=''prospect'' then perform' in body)=0 then raise exception 'Reply routing prerequisite changed';end if;
 body:=replace(body,'if role_name=''prospect'' then perform','if role_name in (''prospect'',''customer'') then perform');
 execute body;
 select pg_get_functiondef('public.icash_webinar_activate_customers()'::regprocedure) into strict body;
 if position('update public.icash_webinar_outbox set state=''canceled'' where state in' in body)=0 then raise exception 'Customer activation prerequisite changed';end if;
 body:=replace(body,'update public.icash_webinar_outbox set state=''canceled'' where state in','update public.icash_webinar_outbox set state=''canceled'' where destination<>''vip'' and state in');
 body:=replace(body,'''webinar-email-bounded-2026-10-17''','''webinar-email-bounded-2026-10-17'',''webinar-email-recovery-2026-10-17''');
 execute replace(body,'''webinar-sms-bounded-2026-10-17''','''webinar-sms-bounded-2026-10-17'',''webinar-sms-recovery-2026-10-17''');
end $$;
do $$ declare signature text;begin
 foreach signature in array array['icash_webinar_contact_lock(uuid)','icash_webinar_same_contact(uuid,uuid)','icash_webinar_contact_recovery(uuid,uuid,text,text,text,boolean,boolean)','icash_webinar_queue_recovery(uuid,uuid,text,uuid)','icash_webinar_record_presence(uuid,uuid,uuid,bigint,text,text)','icash_webinar_paid_recovery()','icash_webinar_recovery_valid(uuid)','icash_webinar_claim_followups(boolean,boolean,uuid)','icash_webinar_followup_allowed(uuid)','icash_webinar_finish_followup(uuid,text)','icash_webinar_vip_link(uuid)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';execute 'grant execute on function public.'||signature||' to service_role';end loop;
end $$;
notify pgrst,'reload schema';
commit;
