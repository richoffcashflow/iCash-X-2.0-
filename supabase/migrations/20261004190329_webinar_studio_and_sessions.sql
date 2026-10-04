-- Additive webinar subsystem. All privileged access is through authenticated server routes.
create table public.icash_webinars (
 id uuid primary key default gen_random_uuid(), revision integer not null default 1 check(revision>0),
 config jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.icash_webinar_visitors (
 id uuid primary key default gen_random_uuid(), name text, email text, phone text,
 timezone text not null default 'America/Chicago', attribution jsonb not null default '{}',
 email_consent_at timestamptz, consent_version text, opted_out_at timestamptz,
 account_id uuid references public.icash_accounts(id), funded_at timestamptz, funding_guest_hash text,
 created_at timestamptz not null default now(), last_seen_at timestamptz not null default now()
);
create index icash_webinar_visitors_email on public.icash_webinar_visitors(lower(email)) where email is not null;
create table public.icash_webinar_sessions (
 id uuid primary key default gen_random_uuid(), visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 webinar_id uuid not null references public.icash_webinars(id), revision integer not null, config jsonb not null,
 progress_seconds integer not null default 0 check(progress_seconds>=0), max_seconds integer not null default 0 check(max_seconds>=0),
 completed_at timestamptz, is_preview boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(visitor_id,webinar_id,revision)
);
create index icash_webinar_sessions_visitor on public.icash_webinar_sessions(visitor_id,updated_at desc);
create table public.icash_webinar_events (
 id uuid primary key default gen_random_uuid(), visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 session_id uuid not null references public.icash_webinar_sessions(id) on delete cascade,
 kind text not null check(kind in ('started','name_saved','contact_saved','pitch_shown','checkout_opened','completed','chat_question','returning_customer')),
 event_key text not null, created_at timestamptz not null default now(), unique(session_id,kind,event_key)
);
create index icash_webinar_events_kind on public.icash_webinar_events(kind,created_at desc);
create table public.icash_webinar_messages (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.icash_webinar_sessions(id) on delete cascade,
 role text not null check(role in ('user','assistant')), text text not null check(length(text)<=3000), created_at timestamptz not null default now()
);
create index icash_webinar_messages_session on public.icash_webinar_messages(session_id,created_at);
create table public.icash_webinar_settings (
 id integer primary key check(id=1), config jsonb not null,
 updated_at timestamptz not null default now()
);
insert into public.icash_webinar_settings(id,config) values(1,'{"enabled":false,"fromEmail":"","postalAddress":"","subjects":["Your iCash X session is saved","Ready to see the rest?","Your next step with iCash X"],"messages":["Pick up your session where you left off. Your place is saved.","See how the iCash X workspace works, then choose whether it fits your goals.","Finish the walkthrough whenever you are ready. You can review the current budget and terms before starting."]}');
create table public.icash_webinar_suppressions (email text primary key, reason text not null, created_at timestamptz not null default now());
create table public.icash_webinar_followups (
 id uuid primary key default gen_random_uuid(), visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 email text not null, step integer not null check(step between 0 and 2),
 state text not null default 'pending' check(state in ('pending','sending','sent','canceled','failed')),
 due_at timestamptz not null, claimed_at timestamptz, first_attempt_at timestamptz, attempts integer not null default 0,
 provider_id text, payload jsonb, sent_at timestamptz, unique(email,step)
);
create index icash_webinar_followups_due on public.icash_webinar_followups(state,due_at);

do $$ declare t text; begin
 foreach t in array array['icash_webinars','icash_webinar_visitors','icash_webinar_sessions','icash_webinar_events','icash_webinar_messages','icash_webinar_settings','icash_webinar_suppressions','icash_webinar_followups'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.icash_webinar_record(p_visitor uuid,p_session uuid,p_seconds integer,p_kind text,p_key text default 'once') returns void
language plpgsql security invoker set search_path=public as $$
declare s public.icash_webinar_sessions; seconds integer;
begin
 select * into s from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor for update;
 if not found then raise exception 'session not found';end if;
 seconds:=greatest(0,least(p_seconds,(s.config->>'durationSeconds')::integer));
 update public.icash_webinar_sessions set progress_seconds=seconds,max_seconds=greatest(max_seconds,seconds),updated_at=now(),
 completed_at=case when p_kind='completed' and seconds>=(s.config->>'durationSeconds')::integer-5 then coalesce(completed_at,now()) else completed_at end where id=s.id;
 if p_kind<>'progress' then insert into public.icash_webinar_events(visitor_id,session_id,kind,event_key) values(p_visitor,p_session,p_kind,left(p_key,100)) on conflict do nothing;end if;
 update public.icash_webinar_visitors set last_seen_at=now() where id=p_visitor;
end $$;

create function public.icash_webinar_contact(p_visitor uuid,p_name text,p_email text,p_phone text,p_consent boolean) returns void
language plpgsql security invoker set search_path=public as $$
declare v public.icash_webinar_visitors; n integer;
begin
 select * into v from public.icash_webinar_visitors where id=p_visitor for update;
 if not found then raise exception 'visitor not found';end if;
 if p_email is distinct from v.email then update public.icash_webinar_followups set state='canceled' where visitor_id=p_visitor and state='pending';end if;
 update public.icash_webinar_visitors set name=nullif(p_name,''),email=nullif(lower(p_email),''),phone=nullif(p_phone,''),
 email_consent_at=case when p_consent and p_email<>'' then coalesce(v.email_consent_at,now()) else null end,
 consent_version=case when p_consent then 'webinar-email-2026-10-04' else null end where id=p_visitor;
 if p_consent and p_email<>'' and v.opted_out_at is null and v.funded_at is null and v.account_id is null
 and not exists(select 1 from public.icash_webinar_suppressions where email=lower(p_email)) then
 for n in 0..2 loop
 insert into public.icash_webinar_followups(visitor_id,email,step,due_at)
 values(p_visitor,lower(p_email),n,now()+case n when 0 then interval '1 hour' when 1 then interval '24 hours' else interval '72 hours' end) on conflict do nothing;
 end loop;
 end if;
end $$;

create function public.icash_webinar_claim_emails() returns setof public.icash_webinar_followups
language plpgsql security invoker set search_path=public as $$
begin
 -- Never retry an ambiguous delivery beyond the provider's idempotency window.
 update public.icash_webinar_followups set state='failed' where state in ('pending','sending') and first_attempt_at<now()-interval '20 hours';
 update public.icash_webinar_followups set state='pending' where state='sending' and claimed_at<now()-interval '5 minutes' and attempts<4;
 return query with selected as (
 select id from public.icash_webinar_followups where state='pending' and due_at<=now() and attempts<4 order by due_at for update skip locked limit 4
 ) update public.icash_webinar_followups f set state='sending',claimed_at=now(),first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1
 from selected where f.id=selected.id returning f.*;
end $$;

revoke all on function public.icash_webinar_record(uuid,uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.icash_webinar_contact(uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.icash_webinar_claim_emails() from public,anon,authenticated;
grant execute on function public.icash_webinar_record(uuid,uuid,integer,text,text), public.icash_webinar_contact(uuid,text,text,text,boolean), public.icash_webinar_claim_emails() to service_role;

-- Owner-only signed uploads; public videos are intended webinar assets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('icash-webinars','icash-webinars',true,2147483648,array['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;

create function public.icash_webinar_stats() returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object(
 'visitors',(select count(distinct visitor_id) from icash_webinar_sessions where not is_preview),
 'optIns',(select count(*) from icash_webinar_visitors v where email_consent_at is not null and opted_out_at is null and exists(select 1 from icash_webinar_sessions s where s.visitor_id=v.id and not s.is_preview)),
 'starts',(select count(distinct e.session_id) from icash_webinar_events e join icash_webinar_sessions s on s.id=e.session_id where e.kind='started' and not s.is_preview),
 'completions',(select count(*) from icash_webinar_sessions where completed_at is not null and not is_preview),
 'pitches',(select count(distinct e.session_id) from icash_webinar_events e join icash_webinar_sessions s on s.id=e.session_id where e.kind='pitch_shown' and not s.is_preview),
 'checkouts',(select count(distinct e.session_id) from icash_webinar_events e join icash_webinar_sessions s on s.id=e.session_id where e.kind='checkout_opened' and not s.is_preview),
 'fundedVisitors',(select count(*) from icash_webinar_visitors v where exists(select 1 from icash_webinar_sessions s where s.visitor_id=v.id and not s.is_preview) and (exists(select 1 from icash_funding_orders f where f.mode='live' and f.state='paid' and (f.guest_hash=v.funding_guest_hash or (v.email is not null and lower(f.payer_email)=lower(v.email)))) or exists(select 1 from icash_memberships m where m.mode='live' and m.paid_through is not null and (m.guest_hash=v.funding_guest_hash or (v.email is not null and lower(m.payer_email)=lower(v.email)))))),
 'emailsSent',(select count(*) from icash_webinar_followups where state='sent'),
 'emailFailures',(select count(*) from icash_webinar_followups where state='failed'),
 'sessions',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select w.id,w.config->>'title' as title,count(s.id) as visits,count(s.id) filter(where s.completed_at is not null) as completed,coalesce(round(avg(s.max_seconds)),0) as average_seconds from icash_webinars w left join icash_webinar_sessions s on s.webinar_id=w.id and not s.is_preview group by w.id) x)
 )
$$;
revoke all on function public.icash_webinar_stats() from public,anon,authenticated;
grant execute on function public.icash_webinar_stats() to service_role;

create function public.icash_webinar_unsubscribe(p_visitor uuid,p_reason text) returns void language plpgsql security invoker set search_path=public as $$
declare address text;
begin
 select email into address from icash_webinar_visitors where id=p_visitor;
 if address is not null then
 insert into icash_webinar_suppressions(email,reason) values(lower(address),left(p_reason,50)) on conflict(email) do nothing;
 update icash_webinar_visitors set opted_out_at=now(),email_consent_at=null where lower(email)=lower(address);
 update icash_webinar_followups set state='canceled' where email=lower(address) and state in ('pending','sending');
 end if;
 update icash_webinar_visitors set opted_out_at=now(),email_consent_at=null where id=p_visitor;
end $$;
revoke all on function public.icash_webinar_unsubscribe(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_unsubscribe(uuid,text) to service_role;

create table public.icash_webinar_email_receipts(provider_id uuid not null,kind text not null,created_at timestamptz not null default now(),primary key(provider_id,kind));
alter table public.icash_webinar_email_receipts enable row level security;
revoke all on public.icash_webinar_email_receipts from public,anon,authenticated;
grant all on public.icash_webinar_email_receipts to service_role;
create function public.icash_webinar_email_event(p_email uuid,p_kind text) returns void language plpgsql security invoker set search_path=public as $$
declare visitor uuid;
begin
 if p_kind not in ('email.bounced','email.complained','email.suppressed') then return;end if;
 insert into icash_webinar_email_receipts(provider_id,kind) values(p_email,p_kind) on conflict do nothing;
 select visitor_id into visitor from icash_webinar_followups where provider_id=p_email::text limit 1;
 if visitor is not null then perform icash_webinar_unsubscribe(visitor,p_kind);end if;
end $$;
revoke all on function public.icash_webinar_email_event(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_email_event(uuid,text) to service_role;
