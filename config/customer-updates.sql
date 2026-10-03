-- Account-owned activity inbox and opt-in bot updates. No enrollment or sends on install.
begin;
create table public.icash_customer_update_settings (
 id integer primary key check(id=1), enabled boolean not null default false,
 global_daily_limit integer not null default 100 check(global_daily_limit between 1 and 10000),
 next_scan_at timestamptz not null default now()
);
insert into public.icash_customer_update_settings(id) values(1);
create table public.icash_customer_update_preferences (
 account_id uuid primary key references public.icash_accounts(id), owner_user_id uuid not null,
 email_enabled boolean not null default false, sms_enabled boolean not null default false,
 email_suppressed_at timestamptz, consent_email text, phone text check(phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
 timezone text not null default 'America/Chicago', consent_version text, consented_at timestamptz,
 revision integer not null default 0, seen_at timestamptz,
 unsubscribe_token text not null unique default (gen_random_uuid()::text||gen_random_uuid()::text),
 next_scan_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(not email_enabled or consent_email is not null), check(not sms_enabled or phone is not null),
 check(not(email_enabled or sms_enabled) or (consent_version='bot-updates-2026-10-03.1' and consented_at is not null))
);
create table public.icash_customer_update_deliveries (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 channel text not null check(channel in ('email','sms')), source_key text not null,
 kind text not null, screening_id uuid not null, recipient text not null, preference_revision integer not null,
 state text not null default 'claimed' check(state in ('claimed','accepted','needs_review','canceled','delivered','bounced','complained','failed','suppressed')),
 created_at timestamptz not null default now(), authorized_at timestamptz, provider_id text,
 unique(account_id,channel,source_key)
);
create index icash_customer_update_scan on public.icash_customer_update_preferences(next_scan_at) where email_enabled or sms_enabled;
create index icash_customer_update_budget on public.icash_customer_update_deliveries(account_id,channel,created_at desc);
create index icash_customer_update_global_budget on public.icash_customer_update_deliveries(created_at desc);
alter table public.icash_customer_update_settings enable row level security;
alter table public.icash_customer_update_preferences enable row level security;
alter table public.icash_customer_update_deliveries enable row level security;
revoke all on public.icash_customer_update_settings,public.icash_customer_update_preferences,public.icash_customer_update_deliveries from public,anon,authenticated;
grant select,insert,update on public.icash_customer_update_settings,public.icash_customer_update_preferences,public.icash_customer_update_deliveries to service_role;

create function public.icash_customer_update_sources(p_account uuid)
returns table(source_key text,kind text,screening_id uuid,event_at timestamptz,priority integer)
language sql stable security invoker set search_path='' as $$
 with recent as (
  select 'reply:'||m.id::text source_key,'seller_reply'::text kind,d.screening_id,m.created_at event_at,2 priority
  from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where m.account_id=p_account and m.direction='incoming' and m.state='received' and t.party='seller' and m.created_at>now()-interval '14 days'
  union all
  select 'signature:'||e.id::text,'contract_signed',d.screening_id,e.updated_at,1
  from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.account_id=p_account and e.state='completed' and not e.test_mode and e.updated_at>now()-interval '14 days'
  union all
  select 'deal:'||d.id::text||':'||d.stage,'deal_'||d.stage,d.screening_id,d.updated_at,1
  from public.icash_deal_files d where d.account_id=p_account and d.stage in ('title_open','closing','closed') and d.updated_at>now()-interval '14 days'
  union all
  select 'research:'||s.id::text,'research_complete',s.id,s.completed_at,4
  from public.icash_screening_jobs s where s.account_id=p_account and s.state='complete' and s.completed_at>now()-interval '14 days'
  union all
  select 'attention:'||s.kind||':'||s.source_id::text||':'||s.source_version,'needs_you',s.screening_id,s.event_at,0
  from public.icash_attention_sources(p_account) s
 ) select r.* from recent r join public.icash_screening_jobs p on p.id=r.screening_id and p.account_id=p_account
 where coalesce(p.result->'property'->>'propertyId','') not like 'practice_%'
 and not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=p.id and coalesce(d.terms->>'practice','false')='true')
 order by r.event_at desc,r.source_key limit 50;
$$;

create function public.icash_customer_update_preferences_get(p_account uuid,p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.icash_customer_update_preferences;email_address text;checkout_phone text;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account required';end if;
 select lower(email) into email_address from auth.users where id=p_user and email_confirmed_at is not null;
 select * into p from public.icash_customer_update_preferences where account_id=p_account and owner_user_id=p_user;
 select payer_phone into checkout_phone from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null and payer_phone ~ '^\+[1-9][0-9]{7,14}$' order by paid_at desc limit 1;
 return jsonb_build_object('email',email_address,'phone',coalesce(p.phone,checkout_phone),'emailEnabled',coalesce(p.email_enabled and p.consent_email=email_address,false),'smsEnabled',coalesce(p.sms_enabled,false),'timezone',coalesce(p.timezone,'America/Chicago'),'seenAt',p.seen_at,'emailSuppressed',p.email_suppressed_at is not null);
end $$;

create function public.icash_customer_update_preferences_save(p_account uuid,p_user uuid,p_email boolean,p_sms boolean,p_phone text,p_timezone text,p_consent text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare email_address text;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account required';end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Timezone required';end if;
 select lower(email) into email_address from auth.users where id=p_user and email_confirmed_at is not null;
 if (p_email or p_sms) and p_consent is distinct from 'bot-updates-2026-10-03.1' then raise exception 'Confirm update preferences';end if;
 if p_email and email_address is null then raise exception 'Verified email required';end if;
 if (p_email or p_sms) and not exists(select 1 from public.icash_customer_update_settings where id=1 and enabled) then raise exception 'Updates unavailable';end if;
 if p_email and exists(select 1 from public.icash_customer_update_preferences where account_id=p_account and email_suppressed_at is not null and consent_email=email_address) then raise exception 'Email delivery paused; contact support';end if;
 if p_sms and (p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$') then raise exception 'Phone required';end if;
 insert into public.icash_customer_update_preferences(account_id,owner_user_id,email_enabled,sms_enabled,consent_email,phone,timezone,consent_version,consented_at,revision)
 values(p_account,p_user,p_email,p_sms,email_address,p_phone,p_timezone,p_consent,now(),1)
 on conflict(account_id) do update set owner_user_id=p_user,email_suppressed_at=case when public.icash_customer_update_preferences.consent_email is distinct from email_address then null else public.icash_customer_update_preferences.email_suppressed_at end,email_enabled=p_email,sms_enabled=p_sms,consent_email=email_address,phone=p_phone,timezone=p_timezone,consent_version=p_consent,consented_at=now(),revision=public.icash_customer_update_preferences.revision+1,updated_at=now();
 update public.icash_customer_update_deliveries set state='canceled' where account_id=p_account and state='claimed' and authorized_at is null;
 return public.icash_customer_update_preferences_get(p_account,p_user);
end $$;

create function public.icash_customer_updates_seen(p_account uuid,p_user uuid,p_before timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account required';end if;
 if p_before is null or p_before>now()+interval '1 minute' then raise exception 'Invalid seen time';end if;
 insert into public.icash_customer_update_preferences(account_id,owner_user_id,seen_at) values(p_account,p_user,p_before)
 on conflict(account_id) do update set seen_at=greatest(public.icash_customer_update_preferences.seen_at,p_before);
end $$;

create function public.icash_claim_customer_update(p_account uuid,p_email_ready boolean,p_sms_ready boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare p public.icash_customer_update_preferences;s record;chosen text;recipient text;email_address text;result uuid;settings public.icash_customer_update_settings;
begin
 select * into settings from public.icash_customer_update_settings where id=1 and enabled for update;
 if not found then return null;end if;
 select * into p from public.icash_customer_update_preferences where account_id=p_account for update;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p.owner_user_id) or not(p.email_enabled or p.sms_enabled) or p.consent_version is distinct from 'bot-updates-2026-10-03.1' then return null;end if;
 select lower(u.email) into email_address from auth.users u join public.icash_accounts a on a.owner_user_id=u.id where a.id=p_account and u.email_confirmed_at is not null;
 if (select count(*) from public.icash_customer_update_deliveries where created_at>now()-interval '24 hours')>=settings.global_daily_limit then return null;end if;
 for chosen in select unnest(array['email','sms']) loop
  if chosen='email' and (p_email_ready and p.email_enabled and p.email_suppressed_at is null and p.consent_email=email_address) is not true then continue;end if;
  if chosen='sms' and not(p_sms_ready and p.sms_enabled and p.phone is not null) then continue;end if;
  if chosen='sms' and extract(hour from now() at time zone p.timezone) not between 9 and 19 then continue;end if;
  if (select count(*) from public.icash_customer_update_deliveries where account_id=p_account and channel=chosen and created_at>now()-interval '24 hours')>=3
   or exists(select 1 from public.icash_customer_update_deliveries where account_id=p_account and channel=chosen and created_at>now()-interval '1 hour') then continue;end if;
  select * into s from public.icash_customer_update_sources(p_account) x where x.event_at>=p.consented_at
   and not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.source_key=x.source_key)
   and (x.kind<>'research_complete' or not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.kind='research_complete' and n.created_at>now()-interval '24 hours'))
   order by x.priority,x.event_at desc limit 1;
  if not found then continue;end if;
  recipient:=case when chosen='email' then email_address else p.phone end;
  insert into public.icash_customer_update_deliveries(account_id,channel,source_key,kind,screening_id,recipient,preference_revision)
   values(p_account,chosen,s.source_key,s.kind,s.screening_id,recipient,p.revision) returning id into result;
  return result;
 end loop;
 return null;
end $$;

create function public.icash_authorize_customer_update(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.icash_customer_update_preferences;n public.icash_customer_update_deliveries;email_address text;
begin
 perform 1 from public.icash_customer_update_settings where id=1 and enabled for share;if not found then return null;end if;
 select * into p from public.icash_customer_update_preferences where account_id=p_account for update;
 select * into n from public.icash_customer_update_deliveries where id=p_id and account_id=p_account for update;
 if not found or n.state<>'claimed' or n.authorized_at is not null then return null;end if;
 select lower(u.email) into email_address from auth.users u join public.icash_accounts a on a.owner_user_id=u.id where a.id=p_account and u.email_confirmed_at is not null;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p.owner_user_id) or n.preference_revision<>p.revision or n.created_at<now()-interval '2 minutes'
  or (n.channel='email' and (not p.email_enabled or p.email_suppressed_at is not null or n.recipient is distinct from email_address or p.consent_email is distinct from email_address))
  or (n.channel='sms' and (not p.sms_enabled or n.recipient is distinct from p.phone))
  or not exists(select 1 from public.icash_customer_update_sources(p_account) s where s.source_key=n.source_key and s.screening_id=n.screening_id) then
  update public.icash_customer_update_deliveries set state='canceled' where id=n.id;return null;
 end if;
 update public.icash_customer_update_deliveries set authorized_at=now() where id=n.id;
 return jsonb_build_object('id',n.id,'channel',n.channel,'kind',n.kind,'screeningId',n.screening_id,'recipient',n.recipient,'unsubscribeToken',p.unsubscribe_token);
end $$;

create function public.icash_finish_customer_update(p_account uuid,p_id uuid,p_provider text) returns void
language sql security invoker set search_path='' as $$
 update public.icash_customer_update_deliveries set state=case when p_provider is null then 'needs_review' else 'accepted' end,provider_id=p_provider where id=p_id and account_id=p_account and state='claimed' and authorized_at is not null;
$$;
create function public.icash_stop_customer_updates(p_token text) returns void
language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 update public.icash_customer_update_preferences set email_enabled=false,sms_enabled=false,revision=revision+1,updated_at=now() where unsubscribe_token=p_token returning account_id into a;
 update public.icash_customer_update_deliveries set state='canceled' where account_id=a and state='claimed' and authorized_at is null;
end $$;
create function public.icash_stop_customer_update_phone(p_phone text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_customer_update_preferences set sms_enabled=false,revision=revision+1,updated_at=now() where phone=p_phone;
 update public.icash_customer_update_deliveries set state='canceled' where channel='sms' and recipient=p_phone and state='claimed' and authorized_at is null;
end $$;

create function public.icash_customer_update_delivery_event(p_id uuid,p_provider uuid,p_recipient text,p_event text) returns void
language plpgsql security invoker set search_path='' as $$
declare n public.icash_customer_update_deliveries;
begin
 if p_event not in ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed') then return;end if;
 select * into n from public.icash_customer_update_deliveries where channel='email' and recipient=lower(p_recipient) and authorized_at is not null
  and (provider_id=p_provider::text or (id=p_id and provider_id is null));
 if not found then return;end if;
 perform 1 from public.icash_customer_update_preferences where account_id=n.account_id for update;
 select * into n from public.icash_customer_update_deliveries where id=n.id for update;
 if n.provider_id is not null and n.provider_id<>p_provider::text then return;end if;
 if p_event in ('email.bounced','email.complained','email.suppressed') then
  update public.icash_customer_update_preferences set email_enabled=false,email_suppressed_at=now(),revision=revision+1,updated_at=now() where account_id=n.account_id and consent_email=n.recipient;
 end if;
 if n.state in ('bounced','complained','suppressed') then return;end if;
 update public.icash_customer_update_deliveries set state=replace(p_event,'email.',''),provider_id=p_provider::text where id=n.id;
end $$;

-- Private existing worker scheduler: preserve all current jobs and admission checks.
alter function public.icash_next_automation() rename to icash_next_automation_before_customer_updates;
do $$ declare expression text;begin
 select pg_get_constraintdef(oid) into strict expression from pg_constraint where conrelid='public.icash_automation_tickets'::regclass and conname='icash_automation_tickets_kind_check';
 execute 'alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check';
 execute 'alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check (kind = ''customer_updates'' or '||substring(expression from 7)||')';
end $$;
create function public.icash_next_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior jsonb;p public.icash_customer_update_preferences;t public.icash_automation_tickets;
begin
 prior:=public.icash_next_automation_before_customer_updates();if prior is not null then return prior;end if;
 begin
  perform 1 from public.icash_customer_update_settings where id=1 and enabled and next_scan_at<=now() for update skip locked;if not found then return null;end if;
  select * into p from public.icash_customer_update_preferences x where (x.email_enabled or x.sms_enabled) and x.next_scan_at<=now()
   and not exists(select 1 from public.icash_automation_tickets j where j.account_id=x.account_id and j.kind='customer_updates' and ((j.state='issued' and j.expires_at>now()) or (j.state='consumed' and j.created_at>now()-interval '5 minutes')))
   order by x.next_scan_at,x.account_id for update skip locked limit 1;
  if not found then return null;end if;
  update public.icash_customer_update_settings set next_scan_at=now()+interval '1 minute' where id=1;
  update public.icash_customer_update_preferences set next_scan_at=now()+interval '15 minutes' where account_id=p.account_id;
  insert into public.icash_automation_tickets(account_id,kind) values(p.account_id,'customer_updates') returning * into t;
  return jsonb_build_object('token',t.token);
 exception when others then return null;
 end;
end $$;
revoke all on function public.icash_customer_update_sources(uuid),public.icash_customer_update_preferences_get(uuid,uuid),public.icash_customer_update_preferences_save(uuid,uuid,boolean,boolean,text,text,text),public.icash_customer_updates_seen(uuid,uuid,timestamptz),public.icash_claim_customer_update(uuid,boolean,boolean),public.icash_authorize_customer_update(uuid,uuid),public.icash_finish_customer_update(uuid,uuid,text),public.icash_stop_customer_updates(text),public.icash_stop_customer_update_phone(text),public.icash_customer_update_delivery_event(uuid,uuid,text,text),public.icash_next_automation(),public.icash_next_automation_before_customer_updates() from public,anon,authenticated;
grant execute on function public.icash_customer_update_sources(uuid),public.icash_customer_update_preferences_get(uuid,uuid),public.icash_customer_update_preferences_save(uuid,uuid,boolean,boolean,text,text,text),public.icash_customer_updates_seen(uuid,uuid,timestamptz),public.icash_claim_customer_update(uuid,boolean,boolean),public.icash_authorize_customer_update(uuid,uuid),public.icash_finish_customer_update(uuid,uuid,text),public.icash_stop_customer_updates(text),public.icash_stop_customer_update_phone(text),public.icash_customer_update_delivery_event(uuid,uuid,text,text),public.icash_next_automation(),public.icash_next_automation_before_customer_updates() to service_role;
commit;
