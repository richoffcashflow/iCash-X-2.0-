-- Existing-customer launch. Importing contacts never starts outreach or grants access.
create table public.icash_legacy_launches (
 id uuid primary key default gen_random_uuid(), slug text not null unique,
 title text not null, state text not null default 'draft' check(state in ('draft','active','paused')),
 revision integer not null default 1, approved_revision integer, approved_at timestamptz, started_at timestamptz,
 history_reviewed_at timestamptz, history_evidence text, webinar_id uuid references public.icash_webinars(id),
 steps jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.icash_legacy_contacts (
 id uuid primary key default gen_random_uuid(), launch_id uuid not null references public.icash_legacy_launches(id),
 email text, phone text, name text not null default '', sources text[] not null default '{}', source_ids text[] not null default '{}', products text[] not null default '{}',
 token text not null unique default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
 email_permission boolean not null default false, sms_permission boolean not null default false,
 suppressed_reason text, stopped_at timestamptz, replied_at timestamptz, converted_at timestamptz, membership_id uuid references public.icash_memberships(id),
 first_visit_at timestamptz, last_visit_at timestamptz, last_purchase_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(email is not null or phone is not null),check(email is null or (email=lower(trim(email)) and length(email)<=254 and position('@' in email)>1)),
 check(phone is null or phone ~ '^\+[1-9][0-9]{7,14}$')
);
create unique index icash_legacy_email on public.icash_legacy_contacts(launch_id,email) where email is not null;
create unique index icash_legacy_phone_only on public.icash_legacy_contacts(launch_id,phone) where email is null;
create index icash_legacy_phone on public.icash_legacy_contacts(phone);
create table public.icash_legacy_visitors (
 contact_id uuid not null references public.icash_legacy_contacts(id), visitor_id uuid not null references public.icash_webinar_visitors(id),
 primary key(contact_id,visitor_id)
);
create table public.icash_legacy_outbox (
 id uuid primary key default gen_random_uuid(), launch_id uuid not null references public.icash_legacy_launches(id), contact_id uuid not null references public.icash_legacy_contacts(id),
 step_id text not null, cycle integer not null default 0, channel text not null check(channel in ('email','sms')), recipient text not null,
 state text not null default 'queued' check(state in ('queued','sending','accepted','delivered','failed','uncertain','cancelled')),
 due_at timestamptz not null, subject text not null default '', body text not null, sender text, revision integer not null,
 provider_id text, sent_at timestamptz, updated_at timestamptz not null default now(),
 unique(launch_id,step_id,cycle,channel,recipient)
);
create index icash_legacy_outbox_due on public.icash_legacy_outbox(due_at) where state='queued';
create index icash_legacy_outbox_contact on public.icash_legacy_outbox(contact_id);
create unique index icash_legacy_outbox_provider on public.icash_legacy_outbox(channel,provider_id) where provider_id is not null;
alter table public.icash_legacy_launches enable row level security;
alter table public.icash_legacy_contacts enable row level security;
alter table public.icash_legacy_outbox enable row level security;
alter table public.icash_legacy_visitors enable row level security;
revoke all on public.icash_legacy_launches,public.icash_legacy_contacts,public.icash_legacy_outbox,public.icash_legacy_visitors from public,anon,authenticated;
grant select,insert,update on public.icash_legacy_launches,public.icash_legacy_contacts,public.icash_legacy_outbox,public.icash_legacy_visitors to service_role;

create function public.icash_legacy_sync(p_launch uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Any receipt-backed live purchase stops this acquisition sequence permanently,
 -- including a customer who later cancels or refunds. A pending checkout never counts.
 with purchased as (
  select c.id,min(i.recorded_at) paid_at,(array_agg(m.id order by i.recorded_at))[1] membership_id
  from public.icash_legacy_contacts c join public.icash_memberships m on m.mode='live' and c.email=lower(trim(m.payer_email))
  join public.icash_membership_invoices i on i.membership_id=m.id
  where c.launch_id=p_launch and c.converted_at is null group by c.id
 ) update public.icash_legacy_contacts c set converted_at=p.paid_at,membership_id=p.membership_id,updated_at=now() from purchased p where p.id=c.id;
 update public.icash_legacy_contacts c set suppressed_reason='Refund or dispute in billing history',stopped_at=coalesce(stopped_at,now())
 where c.launch_id=p_launch and c.suppressed_reason is null and exists(
  select 1 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id
  join public.icash_billing_reviews r on r.payment_id=i.stripe_payment_id where m.mode='live' and lower(trim(m.payer_email))=c.email);
 update public.icash_legacy_outbox o set state='cancelled',updated_at=now() from public.icash_legacy_contacts c
 where o.contact_id=c.id and c.launch_id=p_launch and o.state='queued'
 and (c.converted_at is not null or c.stopped_at is not null or c.suppressed_reason is not null or c.replied_at is not null);
end $$;

create function public.icash_legacy_import(p_launch uuid,p_contacts jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare r jsonb; c public.icash_legacy_contacts; em text; ph text; n integer:=0;
begin
 if jsonb_typeof(p_contacts)<>'array' or jsonb_array_length(p_contacts)>500 then raise exception 'Import up to 500 contacts at a time';end if;
 perform 1 from public.icash_legacy_launches where id=p_launch for update;if not found then raise exception 'Launch not found';end if;
 for r in select value from jsonb_array_elements(p_contacts) loop
  em:=nullif(lower(trim(r->>'email')),'');ph:=nullif(r->>'phone','');
  if (em is null and ph is null) or coalesce(r->>'source','') not in ('whop','highlevel') then raise exception 'Customer contact required';end if;
  c:=null;
  if em is not null then select * into c from public.icash_legacy_contacts where launch_id=p_launch and email=em;
  else select * into c from public.icash_legacy_contacts where launch_id=p_launch and phone=ph and email is null;end if;
  if c.id is null then
   insert into public.icash_legacy_contacts(launch_id,email,phone,name,sources,source_ids,products,suppressed_reason,email_permission,sms_permission,last_purchase_at)
   values(p_launch,em,ph,left(coalesce(r->>'name',''),160),array[r->>'source'],array(select jsonb_array_elements_text(coalesce(r->'sourceIds','[]'))),array(select jsonb_array_elements_text(coalesce(r->'products','[]'))),nullif(r->>'suppressedReason',''),coalesce((r->>'emailPermission')::boolean,false),coalesce((r->>'smsPermission')::boolean,false),nullif(r->>'lastPurchaseAt','')::timestamptz);
  else
   update public.icash_legacy_contacts set phone=coalesce(phone,ph),name=case when name='' then left(coalesce(r->>'name',''),160) else name end,
    sources=array(select distinct unnest(c.sources||array[r->>'source'])),source_ids=array(select distinct unnest(c.source_ids||array(select jsonb_array_elements_text(coalesce(r->'sourceIds','[]'))))),
    products=array(select distinct unnest(c.products||array(select jsonb_array_elements_text(coalesce(r->'products','[]'))))),
    suppressed_reason=coalesce(c.suppressed_reason,nullif(r->>'suppressedReason','')),
    last_purchase_at=greatest(c.last_purchase_at,nullif(r->>'lastPurchaseAt','')::timestamptz),
    email_permission=c.email_permission or coalesce((r->>'emailPermission')::boolean,false),sms_permission=c.sms_permission or coalesce((r->>'smsPermission')::boolean,false),updated_at=now() where id=c.id;
  end if;n:=n+1;
 end loop;
 perform public.icash_legacy_sync(p_launch);return n;
end $$;

create function public.icash_legacy_stop(p_token text) returns void language plpgsql security invoker set search_path='' as $$
declare c public.icash_legacy_contacts;
begin
 select * into c from public.icash_legacy_contacts where token=p_token;if c.id is null then return;end if;
 update public.icash_legacy_contacts set stopped_at=coalesce(stopped_at,now()),suppressed_reason=coalesce(suppressed_reason,'Unsubscribed')
 where (email is not null and email=c.email) or (phone is not null and phone=c.phone) or id=c.id;
 update public.icash_legacy_outbox o set state='cancelled',updated_at=now() from public.icash_legacy_contacts t where t.id=o.contact_id and t.stopped_at is not null and o.state='queued';
end $$;

create function public.icash_legacy_admit(p_contact uuid,p_channel text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_legacy_contacts c join public.icash_legacy_launches l on l.id=c.launch_id
 where c.id=p_contact and l.state='active' and l.approved_at is not null and l.approved_revision=l.revision and l.history_reviewed_at is not null and l.started_at is not null
 and now()>=greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')
 and now()<greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')+interval '30 days'
 and c.suppressed_reason is null and c.stopped_at is null and c.replied_at is null and c.converted_at is null
 and not exists(select 1 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id where m.mode='live' and lower(trim(m.payer_email))=c.email)
 and not exists(select 1 from public.icash_legacy_contacts other where other.id<>c.id and ((c.email is not null and other.email=c.email) or (c.phone is not null and other.phone=c.phone)) and (other.stopped_at is not null or other.suppressed_reason is not null or other.converted_at is not null))
 and case when p_channel='email' then c.email is not null and c.email_permission
  and not exists(select 1 from public.icash_email_suppressions s where lower(s.email)=c.email)
  and not exists(select 1 from public.icash_webinar_suppressions s where lower(s.email)=c.email)
 when p_channel='sms' then c.phone is not null and c.sms_permission
  and not exists(select 1 from public.icash_text_suppressions s where s.phone=c.phone)
  and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=c.phone)
  and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(sha256(convert_to(c.phone,'UTF8')),'hex'))
 else false end);
$$;

create function public.icash_legacy_enqueue() returns integer language plpgsql security invoker set search_path='' as $$
declare l public.icash_legacy_launches;n integer:=0;added integer;
begin
 for l in select * from public.icash_legacy_launches where state='active' and approved_revision=revision and history_reviewed_at is not null loop
  perform public.icash_legacy_sync(l.id);
  insert into public.icash_legacy_outbox(launch_id,contact_id,step_id,cycle,channel,recipient,due_at,subject,body,revision)
  select l.id,c.id,s->>'id',x.cycle,s->>'channel',case when s->>'channel'='email' then c.email else c.phone end,
   greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')+make_interval(days=>(s->>'day')::integer+x.cycle*coalesce((s->>'repeatDays')::integer,0),hours=>coalesce((s->>'hour')::integer,0)),
   coalesce(s->>'subject',''),s->>'body',l.revision
  from public.icash_legacy_contacts c cross join jsonb_array_elements(l.steps) s
  cross join lateral (select case when coalesce((s->>'repeatDays')::integer,0)>0 then greatest(0,floor((extract(epoch from now()-greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days'))/86400-(s->>'day')::integer)/(s->>'repeatDays')::integer)::integer) else 0 end cycle) x
  where c.launch_id=l.id and public.icash_legacy_admit(c.id,s->>'channel')
  and greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')+make_interval(days=>(s->>'day')::integer+x.cycle*coalesce((s->>'repeatDays')::integer,0),hours=>coalesce((s->>'hour')::integer,0))<=now()
  on conflict(launch_id,step_id,cycle,channel,recipient) do nothing;
  get diagnostics added=row_count;n:=n+added;
 end loop;return n;
end $$;

create function public.icash_legacy_claim(p_email boolean,p_sms boolean) returns uuid language plpgsql security invoker set search_path='' as $$
declare job public.icash_legacy_outbox;sender_phone text;
begin
 -- Follow-ups are scheduled in the business clock, 9 AM through 9 PM exclusive.
 if extract(hour from now() at time zone 'America/Chicago') not between 9 and 20 then return null;end if;
 -- Unknown transport results remain held; they are never blindly retried.
 update public.icash_legacy_outbox set state='uncertain',updated_at=now() where state='sending' and updated_at<now()-interval '10 minutes';
 select * into job from public.icash_legacy_outbox o where o.state='queued' and o.due_at<=now()
 and ((o.channel='email' and p_email) or (o.channel='sms' and p_sms)) and public.icash_legacy_admit(o.contact_id,o.channel)
 and not exists(select 1 from public.icash_legacy_outbox prior where prior.recipient=o.recipient and prior.channel=o.channel and prior.state in ('sending','uncertain','accepted','delivered') and (prior.state in ('sending','uncertain') or coalesce(prior.sent_at,prior.updated_at)>now()-interval '20 hours'))
 order by o.due_at,o.id limit 1 for update skip locked;
 if job.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('legacy:'||job.channel||':'||job.recipient,0));
 if exists(select 1 from public.icash_legacy_outbox prior where prior.id<>job.id and prior.recipient=job.recipient and prior.channel=job.channel and prior.state in ('sending','uncertain','accepted','delivered') and (prior.state in ('sending','uncertain') or coalesce(prior.sent_at,prior.updated_at)>now()-interval '20 hours')) then return null;end if;
 if job.channel='sms' then
  select sender into sender_phone from public.icash_legacy_outbox where recipient=job.recipient and channel='sms' and sender is not null order by due_at limit 1;
  if sender_phone is null then select phone into sender_phone from public.icash_webinar_text_senders where enabled and verified_at>now()-interval '7 days' order by preferred desc,phone limit 1;
  elsif not exists(select 1 from public.icash_webinar_text_senders where phone=sender_phone and enabled and verified_at>now()-interval '7 days') then return null;end if;
  if sender_phone is null then return null;end if;
 end if;
 update public.icash_legacy_outbox set state='sending',sender=sender_phone,updated_at=now() where id=job.id;return job.id;
end $$;

create function public.icash_legacy_authorize(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_legacy_outbox;c public.icash_legacy_contacts;l public.icash_legacy_launches;
begin
 select * into j from public.icash_legacy_outbox where id=p_id for update;
 if j.id is null or j.state<>'sending' then return null;end if;
 select * into c from public.icash_legacy_contacts where id=j.contact_id;select * into l from public.icash_legacy_launches where id=j.launch_id;
 if not public.icash_legacy_admit(c.id,j.channel) or j.revision<>l.approved_revision then update public.icash_legacy_outbox set state='cancelled',updated_at=now() where id=j.id;return null;end if;
 return jsonb_build_object('id',j.id,'channel',j.channel,'recipient',j.recipient,'sender',j.sender,'subject',j.subject,'body',j.body,'token',c.token,'name',c.name);
end $$;

create function public.icash_legacy_finish(p_id uuid,p_provider text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_legacy_outbox set state=case when nullif(p_provider,'') is null then 'uncertain' else 'accepted' end,provider_id=nullif(p_provider,''),sent_at=case when nullif(p_provider,'') is not null then now() else null end,updated_at=now() where id=p_id and state='sending';
end $$;

create function public.icash_legacy_delivery(p_channel text,p_provider text,p_kind text) returns void language plpgsql security invoker set search_path='' as $$
declare j public.icash_legacy_outbox;
begin
 select * into j from public.icash_legacy_outbox where channel=p_channel and provider_id=p_provider;if j.id is null then return;end if;
 if p_kind in ('delivered','text.delivery.confirmed') then update public.icash_legacy_outbox set state='delivered',updated_at=now() where id=j.id;
 elsif p_kind in ('bounced','complained','failed','suppressed') then
  update public.icash_legacy_outbox set state='failed',updated_at=now() where id=j.id;
  update public.icash_legacy_contacts set suppressed_reason=coalesce(suppressed_reason,'Delivery '||p_kind),stopped_at=coalesce(stopped_at,now()) where id=j.contact_id;
  update public.icash_legacy_outbox set state='cancelled',updated_at=now() where contact_id=j.contact_id and state='queued';
 end if;
end $$;

create function public.icash_legacy_reply(p_phone text,p_optout boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_legacy_contacts c set replied_at=coalesce(c.replied_at,now()),stopped_at=case when p_optout then coalesce(c.stopped_at,now()) else c.stopped_at end,suppressed_reason=case when p_optout then coalesce(c.suppressed_reason,'SMS opt-out') else c.suppressed_reason end
 where c.phone=p_phone and exists(select 1 from public.icash_legacy_outbox o where o.contact_id=c.id and o.channel='sms' and o.state in ('sending','accepted','delivered','uncertain'));
 update public.icash_legacy_outbox o set state='cancelled',updated_at=now() from public.icash_legacy_contacts c where c.id=o.contact_id and c.phone=p_phone and c.replied_at is not null and o.state='queued';
end $$;

create function public.icash_legacy_save(p_id uuid,p_revision integer,p_steps jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare next_revision integer;
begin
 if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 100 then raise exception 'Sequence required';end if;
 update public.icash_legacy_launches set steps=p_steps,revision=revision+1,approved_at=null,approved_revision=null,state='draft',updated_at=now() where id=p_id and revision=p_revision returning revision into next_revision;
 if next_revision is null then raise exception 'Launch changed; refresh';end if;
 update public.icash_legacy_outbox set state='cancelled',updated_at=now() where launch_id=p_id and state='queued';return next_revision;
end $$;

create function public.icash_legacy_report(p_launch uuid,p_query text default '',p_page integer default 1) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.icash_legacy_launches;result jsonb;
begin
 if p_page<1 or p_page>10000 or length(p_query)>200 then raise exception 'Invalid page';end if;
 perform public.icash_legacy_sync(p_launch);select * into l from public.icash_legacy_launches where id=p_launch;
 with people as materialized (
  select c.*,coalesce(c.last_purchase_at,c.created_at)+interval '7 days' eligible_after,
   exists(select 1 from public.icash_legacy_outbox o where o.contact_id=c.id and o.sent_at is not null) contacted,
   exists(select 1 from public.icash_webinar_sessions s join public.icash_webinar_events e on e.session_id=s.id and e.kind='started' where exists(select 1 from public.icash_legacy_visitors b where b.contact_id=c.id and b.visitor_id=s.visitor_id) and s.config->>'legacyCampaignId'=l.id::text and not s.is_preview) watched,
   (c.converted_at is not null and l.started_at is not null and c.converted_at>=l.started_at and
    (c.first_visit_at<=c.converted_at or exists(select 1 from public.icash_legacy_outbox o where o.contact_id=c.id and o.sent_at<=c.converted_at))) acquired
  from public.icash_legacy_contacts c where c.launch_id=l.id
 ), filtered as materialized (
  select * from people where p_query='' or strpos(lower(coalesce(email,'')||' '||name||' '||coalesce(phone,'')),lower(p_query))>0
 ), paged as (select * from filtered order by created_at,id offset (p_page-1)*100 limit 100)
 select jsonb_build_object('campaign',to_jsonb(l),'counts',jsonb_build_object(
  'customers',(select count(*) from people),'contacted',(select count(*) from people where contacted),
  'visited',(select count(*) from people where first_visit_at is not null),'watched',(select count(*) from people where watched),
  'acquired',(select count(*) from people where acquired),'alreadyPaid',(select count(*) from people where converted_at is not null and not coalesce(acquired,false)),
  'suppressed',(select count(*) from people where suppressed_reason is not null or stopped_at is not null),
  'whop',(select count(*) from people where 'whop'=any(sources)),'highlevel',(select count(*) from people where 'highlevel'=any(sources)),
  'emailPermission',(select count(*) from people where email is not null and email_permission),'smsPermission',(select count(*) from people where phone is not null and sms_permission),
  'emails',(select count(*) from people where email is not null),'phones',(select count(*) from people where phone is not null),
  'cooling',(select count(*) from people where eligible_after>now() and converted_at is null and suppressed_reason is null),
  'sent',(select count(*) from public.icash_legacy_outbox where launch_id=l.id and sent_at is not null),
  'uncertain',(select count(*) from public.icash_legacy_outbox where launch_id=l.id and state='uncertain')),
  'contacts',coalesce((select jsonb_agg(to_jsonb(p)-'token'-'source_ids') from paged p),'[]'),
  'totalMatches',(select count(*) from filtered),'page',p_page,
  'webinarCode',(select public_code from public.icash_webinars where id=l.webinar_id)) into result;
 return result;
end $$;

-- Webinar snapshots identify this campaign permanently. Default dashboards use
-- the filtered views; receipts and historical session rows remain intact.
create view public.icash_regular_webinar_sessions with (security_invoker=true) as select * from public.icash_webinar_sessions where nullif(config->>'legacyCampaignId','') is null;
create view public.icash_regular_webinars with (security_invoker=true) as select * from public.icash_webinars where nullif(config->>'legacyCampaignId','') is null;
revoke all on public.icash_regular_webinar_sessions,public.icash_regular_webinars from public,anon,authenticated;
grant select on public.icash_regular_webinar_sessions,public.icash_regular_webinars to service_role;
do $$ declare signature text;definition text;begin
 foreach signature in array array['public.icash_webinar_daily_report(text,text)','public.icash_webinar_report_with_funnel(text,text)','public.icash_webinar_stats()'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  if position('icash_webinar_sessions' in definition)=0 then raise exception 'Unexpected reporting definition: %',signature;end if;
  definition:=replace(replace(definition,'icash_webinar_sessions','icash_regular_webinar_sessions'),'icash_webinars','icash_regular_webinars');
  -- Views do not inherit the base table primary-key functional dependency.
  definition:=replace(definition,'group by w.id)', 'group by w.id,w.config)');execute definition;
 end loop;
end $$;
create function public.icash_legacy_bind(p_contact uuid,p_visitor uuid) returns void language sql security invoker set search_path='' as $$
 insert into public.icash_legacy_visitors(contact_id,visitor_id) values(p_contact,p_visitor) on conflict do nothing;
$$;
create function public.icash_legacy_payment_stop() returns trigger language plpgsql security invoker set search_path='' as $$
declare em text;l uuid;
begin
 if tg_table_name='icash_membership_invoices' then select lower(trim(payer_email)) into em from public.icash_memberships where id=new.membership_id and mode='live';
 else if new.mode='live' then em:=lower(trim(new.payer_email));end if;end if;
 if em is not null then
  for l in select distinct launch_id from public.icash_legacy_contacts where email=em loop perform public.icash_legacy_sync(l);end loop;
 end if;return new;
end $$;
create trigger icash_legacy_invoice_stop after insert on public.icash_membership_invoices for each row execute function public.icash_legacy_payment_stop();
create trigger icash_legacy_membership_stop after insert or update of payer_email,paid_through on public.icash_memberships for each row execute function public.icash_legacy_payment_stop();
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'icash_legacy_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
