-- STAGED ONLY. Apply after the existing live work/title/reply schemas.
-- Applying this file enables neither dispatch nor a schedule. Both the DB
-- setting and ICASH_ATTENTION_EMAIL_ENABLED must be enabled separately.
begin;
create table public.icash_attention_email_settings (
 id integer primary key check(id=1), enabled boolean not null default false,
 global_daily_limit integer not null default 100 check(global_daily_limit between 1 and 100),
 next_scan_at timestamptz not null default now()
);
insert into public.icash_attention_email_settings(id) values(1);
create table public.icash_attention_email_preferences (
 account_id uuid primary key references public.icash_accounts(id),
 enabled boolean not null default false,
 categories text[] not null default array['needs_you','signatures','callbacks','closing'],
 consent_email text, consent_version text, consented_at timestamptz,
 revision bigint not null default 0 check(revision>=0),
 unsubscribe_token text not null unique default (gen_random_uuid()::text||gen_random_uuid()::text),
 suppressed_at timestamptz, suppression_reason text,
 next_scan_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(categories <@ array['needs_you','signatures','callbacks','closing']::text[]),
 check(not enabled or (cardinality(categories)>0 and consent_email is not null and consent_version='2026-09-30-attention-email-1' and consented_at is not null))
);
create index icash_attention_scan on public.icash_attention_email_preferences(next_scan_at,account_id) where enabled and suppressed_at is null;
create table public.icash_attention_emails (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 owner_user_id uuid not null, recipient text not null,
 kind text not null check(kind in ('text_attention','handoff','sms_callback','live_callback','signature','title_review','closing_deadline')),
 category text not null check(category in ('needs_you','signatures','callbacks','closing')),
 source_id uuid not null, source_version text not null check(length(source_version) between 1 and 150),
 screening_id uuid not null references public.icash_screening_jobs(id), preference_revision bigint not null,
 state text not null default 'claimed' check(state in ('claimed','accepted','delivered','needs_review','cancelled','bounced','complained','failed','suppressed')),
 created_at timestamptz not null default now(), authorized_at timestamptz, completed_at timestamptz,
 provider_id uuid unique,
 unique(account_id,kind,source_id,source_version)
);
create index icash_attention_account_budget on public.icash_attention_emails(account_id,created_at desc);
create index icash_attention_global_budget on public.icash_attention_emails(created_at desc);
alter table public.icash_attention_email_settings enable row level security;
alter table public.icash_attention_email_preferences enable row level security;
alter table public.icash_attention_emails enable row level security;
revoke all on public.icash_attention_email_settings,public.icash_attention_email_preferences,public.icash_attention_emails from public,anon,authenticated;
grant select,insert,update,delete on public.icash_attention_email_settings,public.icash_attention_email_preferences,public.icash_attention_emails to service_role;

-- Metadata only. Every source and property/deal binding is account scoped.
-- A date extracted from a title reply remains review-only until the customer
-- confirms it; only scheduled deadlines are described as confirmed deadlines.
create function public.icash_attention_sources(p_account uuid)
returns table(kind text,category text,source_id uuid,source_version text,screening_id uuid,event_at timestamptz,priority integer)
language sql stable security invoker set search_path='' as $$
 with source as (
  select 'text_attention'::text kind,'needs_you'::text category,t.id source_id,t.message_id::text source_version,t.screening_id,t.deal_id,t.updated_at event_at,3 priority
  from public.icash_text_attention t where t.account_id=p_account and t.state='open'
   and not (t.kind='callback' and exists(select 1 from public.icash_sms_call_requests c where c.account_id=t.account_id and c.message_id=t.message_id))
  union all
  select 'handoff','needs_you',h.id,'open',h.screening_id,null::uuid,h.created_at,3
  from public.icash_handoffs h where h.account_id=p_account and h.state='open'
  union all
  select 'sms_callback','callbacks',c.id,c.message_id::text,c.screening_id,c.deal_id,c.requested_at,2
  from public.icash_sms_call_requests c where c.account_id=p_account and c.state='needs_review'
  union all
  select 'live_callback','callbacks',c.id,c.state||':'||c.due_at::text,c.screening_id,null::uuid,c.due_at,2
  from public.icash_live_callbacks c where c.account_id=p_account and c.state in ('held_for_human','missed')
  union all
  select 'signature','signatures',e.id,'customer_signature_needed',d.screening_id,d.id,e.updated_at,1
  from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.account_id=p_account and e.state='customer_signature_needed' and not e.test_mode
  union all
  select 'title_review','closing',t.id,t.state||':'||coalesce(t.due_date::text,''),d.screening_id,d.id,t.updated_at,2
  from public.icash_title_tasks t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and t.state='needs_review' and d.stage in ('under_contract','buyer_selected','title_open','closing')
  union all
  select 'closing_deadline','closing',t.id,t.state||':'||t.due_date::text,d.screening_id,d.id,t.due_date::timestamp at time zone 'America/Chicago',0
  from public.icash_title_tasks t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and t.kind='deadline' and t.state='scheduled'
   and t.due_date<=(now() at time zone 'America/Chicago')::date+2
   and d.stage in ('under_contract','buyer_selected','title_open','closing')
 )
 select s.kind,s.category,s.source_id,s.source_version,s.screening_id,s.event_at,s.priority
 from source s join public.icash_screening_jobs p on p.id=s.screening_id and p.account_id=p_account and p.state='complete'
 where (s.deal_id is null or exists(select 1 from public.icash_deal_files d where d.id=s.deal_id and d.account_id=p_account and d.screening_id=s.screening_id and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')='false'))
 and not exists(select 1 from public.icash_deal_files d where d.screening_id=s.screening_id and d.account_id=p_account and (d.stage in ('closed','cancelled') or coalesce(d.terms->>'practice','false')<>'false'));
$$;

create function public.icash_attention_preferences(p_account uuid,p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.icash_attention_email_preferences;email_address text;
begin
 select lower(u.email) into email_address from public.icash_accounts a join auth.users u on u.id=a.owner_user_id
 where a.id=p_account and a.owner_user_id=p_user and u.email_confirmed_at is not null;
 if email_address is null then raise exception 'Verified account ownership required';end if;
 select * into p from public.icash_attention_email_preferences where account_id=p_account;
 return jsonb_build_object('enabled',coalesce(p.enabled and p.consent_email=email_address and p.suppressed_at is null,false),
  'categories',coalesce(p.categories,array['needs_you','signatures','callbacks','closing']),
  'suppressed',coalesce(p.suppressed_at is not null and p.consent_email=email_address,false),'email',email_address,
  'available',exists(select 1 from public.icash_attention_email_settings where id=1 and enabled));
end $$;

create function public.icash_save_attention_preferences(p_account uuid,p_user uuid,p_enabled boolean,p_categories text[],p_consent text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare email_address text;p public.icash_attention_email_preferences;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for share;
 if not found then raise exception 'Account ownership required';end if;
 select lower(email) into email_address from auth.users where id=p_user and email_confirmed_at is not null;
 if email_address is null then raise exception 'Verified account email required';end if;
 if p_enabled is null or p_categories is null or not (p_categories<@array['needs_you','signatures','callbacks','closing']::text[]) or cardinality(p_categories)>4 then raise exception 'Invalid preferences';end if;
 if p_enabled and (cardinality(p_categories)=0 or p_consent is distinct from '2026-09-30-attention-email-1') then raise exception 'Explicit email consent required';end if;
 if p_enabled and not exists(select 1 from public.icash_attention_email_settings where id=1 and enabled) then raise exception 'Email alerts are unavailable';end if;
 select * into p from public.icash_attention_email_preferences where account_id=p_account for update;
 if p_enabled and p.suppressed_at is not null and p.consent_email=email_address then raise exception 'Delivery needs review';end if;
 insert into public.icash_attention_email_preferences(account_id,enabled,categories,consent_email,consent_version,consented_at,revision)
 values(p_account,p_enabled,p_categories,email_address,case when p_enabled then p_consent end,case when p_enabled then now() end,1)
 on conflict(account_id) do update set enabled=excluded.enabled,categories=excluded.categories,consent_email=excluded.consent_email,
  consent_version=case when p_enabled then excluded.consent_version else public.icash_attention_email_preferences.consent_version end,
  consented_at=case when p_enabled then now() else public.icash_attention_email_preferences.consented_at end,
  suppressed_at=case when public.icash_attention_email_preferences.consent_email is distinct from email_address then null else public.icash_attention_email_preferences.suppressed_at end,
  suppression_reason=case when public.icash_attention_email_preferences.consent_email is distinct from email_address then null else public.icash_attention_email_preferences.suppression_reason end,
  revision=public.icash_attention_email_preferences.revision+1,updated_at=now();
 -- A preference change cannot authorize an older claim. No source tasks are changed.
 update public.icash_attention_emails set state='cancelled',completed_at=now() where account_id=p_account and state='claimed' and authorized_at is null;
 return public.icash_attention_preferences(p_account,p_user);
end $$;

create function public.icash_claim_attention_email(p_account uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare settings public.icash_attention_email_settings;p public.icash_attention_email_preferences;owner_id uuid;email_address text;s record;result uuid;
begin
 -- A single fixed-order lock serializes platform/account budget admission.
 select * into settings from public.icash_attention_email_settings where id=1 for update;
 if not found or not settings.enabled then return null;end if;
 select owner_user_id into owner_id from public.icash_accounts where id=p_account for share;
 if not found then return null;end if;
 select * into p from public.icash_attention_email_preferences where account_id=p_account for update;
 if not found or not p.enabled or p.suppressed_at is not null or p.consent_version<>'2026-09-30-attention-email-1' then return null;end if;
 select lower(email) into email_address from auth.users where id=owner_id and email_confirmed_at is not null;
 if email_address is null or email_address is distinct from p.consent_email then return null;end if;
 -- Failures/ambiguous sends consume the same budget as accepted mail.
 if (select count(*) from public.icash_attention_emails where created_at>now()-interval '24 hours')>=settings.global_daily_limit
 or (select count(*) from public.icash_attention_emails where account_id=p_account and created_at>now()-interval '24 hours')>=3
 or exists(select 1 from public.icash_attention_emails where account_id=p_account and created_at>now()-interval '1 hour') then return null;end if;
 update public.icash_attention_emails set state='needs_review',completed_at=now() where account_id=p_account and state='claimed' and created_at<now()-interval '2 minutes';
 select x.* into s from public.icash_attention_sources(p_account) x
 where x.category=any(p.categories) and not exists(select 1 from public.icash_attention_emails n where n.account_id=p_account and n.kind=x.kind and n.source_id=x.source_id and n.source_version=x.source_version)
 order by x.priority,x.event_at,x.source_id limit 1;
 if not found then return null;end if;
 insert into public.icash_attention_emails(account_id,owner_user_id,recipient,kind,category,source_id,source_version,screening_id,preference_revision)
 values(p_account,owner_id,email_address,s.kind,s.category,s.source_id,s.source_version,s.screening_id,p.revision) returning id into result;
 return result;
end $$;

create function public.icash_authorize_attention_email(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.icash_attention_email_preferences;n public.icash_attention_emails;owner_id uuid;email_address text;pending_count integer;
begin
 perform 1 from public.icash_attention_email_settings where id=1 and enabled for share;
 if not found then return null;end if;
 select owner_user_id into owner_id from public.icash_accounts where id=p_account for share;
 if not found then return null;end if;
 select * into p from public.icash_attention_email_preferences where account_id=p_account for update;
 select * into n from public.icash_attention_emails where id=p_id and account_id=p_account for update;
 if not found or n.state<>'claimed' or n.authorized_at is not null then return null;end if;
 select lower(email) into email_address from auth.users where id=owner_id and email_confirmed_at is not null;
 if p.account_id is null or not p.enabled or p.suppressed_at is not null or p.revision<>n.preference_revision or not n.category=any(p.categories)
 or p.consent_version is distinct from '2026-09-30-attention-email-1' or n.owner_user_id<>owner_id
 or email_address is null or email_address is distinct from n.recipient or p.consent_email is distinct from email_address
 or n.created_at<now()-interval '2 minutes'
 or not exists(select 1 from public.icash_attention_sources(p_account) x where x.kind=n.kind and x.source_id=n.source_id and x.source_version=n.source_version and x.screening_id=n.screening_id) then
  update public.icash_attention_emails set state='cancelled',completed_at=now() where id=n.id;
  return null;
 end if;
 select count(*)::integer into pending_count from public.icash_attention_sources(p_account) x where x.category=any(p.categories);
 update public.icash_attention_emails set authorized_at=now() where id=n.id;
 return jsonb_build_object('id',n.id,'kind',n.kind,'screeningId',n.screening_id,'recipient',n.recipient,'unsubscribeToken',p.unsubscribe_token,'pendingCount',pending_count);
end $$;

create function public.icash_finish_attention_email(p_account uuid,p_id uuid,p_provider uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 -- A webhook may already have recorded delivery/failure before this receipt.
 update public.icash_attention_emails set state=case when p_provider is null then 'needs_review' else 'accepted' end,provider_id=p_provider,completed_at=now()
 where id=p_id and account_id=p_account and state='claimed' and (p_provider is null or authorized_at is not null);
end $$;

create function public.icash_unsubscribe_attention(p_token text) returns void
language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 if p_token is null or p_token!~'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$' then return;end if;
 update public.icash_attention_email_preferences set enabled=false,revision=revision+1,updated_at=now() where unsubscribe_token=p_token returning account_id into a;
 update public.icash_attention_emails set state='cancelled',completed_at=now() where account_id=a and state='claimed' and authorized_at is null;
end $$;

create function public.icash_attention_delivery_event(p_id uuid,p_provider uuid,p_recipient text,p_event text) returns void
language plpgsql security invoker set search_path='' as $$
declare n public.icash_attention_emails;
begin
 if p_event not in ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed') then return;end if;
 select * into n from public.icash_attention_emails where id=p_id and recipient=lower(p_recipient) and authorized_at is not null;
 if not found then return;end if;
 -- Keep preference -> notification lock order, like dispatch and unsubscribe.
 perform 1 from public.icash_attention_email_preferences where account_id=n.account_id for update;
 select * into n from public.icash_attention_emails where id=p_id for update;
 if n.provider_id is not null and n.provider_id<>p_provider then raise exception 'Provider receipt mismatch';end if;
 if p_event in ('email.bounced','email.complained','email.suppressed') then
  update public.icash_attention_email_preferences set enabled=false,suppressed_at=coalesce(suppressed_at,now()),suppression_reason=p_event,revision=revision+1,updated_at=now()
   where account_id=n.account_id and consent_email=n.recipient and suppressed_at is null;
 end if;
 -- Late delivery cannot undo a bounce/complaint or remove suppression.
 if n.state in ('bounced','complained','suppressed') and p_event='email.delivered' then return;end if;
 update public.icash_attention_emails set provider_id=p_provider,state=replace(p_event,'email.',''),completed_at=now() where id=n.id;
end $$;

revoke all on function public.icash_attention_sources(uuid),public.icash_attention_preferences(uuid,uuid),public.icash_save_attention_preferences(uuid,uuid,boolean,text[],text),public.icash_claim_attention_email(uuid),public.icash_authorize_attention_email(uuid,uuid),public.icash_finish_attention_email(uuid,uuid,uuid),public.icash_unsubscribe_attention(text),public.icash_attention_delivery_event(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_attention_sources(uuid),public.icash_attention_preferences(uuid,uuid),public.icash_save_attention_preferences(uuid,uuid,boolean,text[],text),public.icash_claim_attention_email(uuid),public.icash_authorize_attention_email(uuid,uuid),public.icash_finish_attention_email(uuid,uuid,uuid),public.icash_unsubscribe_attention(text),public.icash_attention_delivery_event(uuid,uuid,text,text) to service_role;
commit;
