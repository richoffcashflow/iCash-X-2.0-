begin;

-- Separate, explicit network enrollment. Never backfill private tenant buyers.
create table public.icash_network_buyers (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id),
 email text not null unique check(email=lower(trim(email)) and length(email) between 3 and 320),
 name text not null check(length(name) between 2 and 100),
 zips text[] not null check(cardinality(zips) between 1 and 20),
 property_types text[] not null check(cardinality(property_types) between 1 and 2 and property_types <@ array['house','land']),
 max_price_cents bigint not null check(max_price_cents between 100000 and 10000000000),
 max_repairs_cents bigint not null check(max_repairs_cents between 0 and 10000000000),
 daily_emails integer not null default 3 check(daily_emails between 1 and 3),
 consent_version text not null check(consent_version='buyer-network-2026-10-10.1'),
 consent_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '30 days'),
 paused boolean not null default false,
 unsubscribe_token text not null unique default replace(gen_random_uuid()::text,'-',''),
 updated_at timestamptz not null default now()
);
create index icash_network_buyers_zips on public.icash_network_buyers using gin(zips) where not paused;
create index icash_network_buyers_expiry on public.icash_network_buyers(expires_at) where not paused;

create table public.icash_network_consents (
 id uuid primary key default gen_random_uuid(),
 buyer_id uuid not null references public.icash_network_buyers(id),
 action text not null check(action in ('enrolled','paused')),
 version text not null, consent_text text not null, preferences jsonb not null,
 created_at timestamptz not null default now()
);
create index icash_network_consents_buyer on public.icash_network_consents(buyer_id,created_at desc);

create table public.icash_network_settings (
 account_id uuid primary key references public.icash_accounts(id),
 enabled boolean not null default true,
 mailing_address text not null check(length(trim(mailing_address)) between 10 and 300),
 updated_at timestamptz not null default now()
);
create table public.icash_network_matches (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 buyer_id uuid not null references public.icash_network_buyers(id),
 property_key text not null,
 state text not null default 'matched' check(state in ('matched','interested','replied','passed')),
 email_id uuid unique references public.icash_deal_emails(id),
 created_at timestamptz not null default now(), responded_at timestamptz, reviewed_at timestamptz,
 unique(buyer_id,property_key), unique(deal_id,buyer_id)
);
create index icash_network_matches_account on public.icash_network_matches(account_id,deal_id,state);
create index icash_network_matches_deal on public.icash_network_matches(deal_id);
create index icash_network_matches_pending on public.icash_network_matches(account_id,created_at) where email_id is null and state='matched';
create index icash_network_matches_buyer_date on public.icash_network_matches(buyer_id,created_at desc);
create index if not exists icash_email_suppressions_email on public.icash_email_suppressions(email);

alter table public.icash_network_buyers enable row level security;
alter table public.icash_network_consents enable row level security;
alter table public.icash_network_settings enable row level security;
alter table public.icash_network_matches enable row level security;
revoke all on public.icash_network_buyers,public.icash_network_consents,public.icash_network_settings,public.icash_network_matches from public,anon,authenticated;
grant select,insert,update on public.icash_network_buyers,public.icash_network_settings,public.icash_network_matches to service_role;
grant select,insert on public.icash_network_consents to service_role;

create function public.icash_network_consent_text() returns text language sql immutable set search_path='' as $$
 select 'I request off-market property packages by email from HomeOffer Network and participating iCash X members for properties matching my preferences, up to my selected daily limit. My name and email may be shared with those members for these deals. I can stop network emails at any time. Joining is free and does not authorize calls or texts.'::text;
$$;

create function public.icash_network_save_buyer(p_user uuid,p_profile jsonb) returns uuid language plpgsql set search_path='' as $$
declare verified_email text;b public.icash_network_buyers;z text[];types text[];
begin
 select lower(trim(email)) into verified_email from auth.users where id=p_user and email_confirmed_at is not null;
 if verified_email is null then raise exception 'Verified email required';end if;
 if p_profile->>'consentVersion' is distinct from 'buyer-network-2026-10-10.1' or p_profile->'accepted' is distinct from 'true'::jsonb
  or jsonb_typeof(p_profile->'zips') is distinct from 'array' or jsonb_typeof(p_profile->'propertyTypes') is distinct from 'array' then raise exception 'Network opt-in required';end if;
 select array_agg(distinct value) into z from jsonb_array_elements_text(p_profile->'zips');
 select array_agg(distinct value) into types from jsonb_array_elements_text(p_profile->'propertyTypes');
 if exists(select 1 from unnest(z) v where v !~ '^[0-9]{5}$') then raise exception 'Five-digit ZIP codes required';end if;
 insert into public.icash_network_buyers(user_id,email,name,zips,property_types,max_price_cents,max_repairs_cents,daily_emails,consent_version)
 values(p_user,verified_email,trim(p_profile->>'name'),z,types,(p_profile->>'maxPriceCents')::bigint,(p_profile->>'maxRepairsCents')::bigint,(p_profile->>'dailyEmails')::integer,p_profile->>'consentVersion')
 on conflict(user_id) do update set email=excluded.email,name=excluded.name,zips=excluded.zips,property_types=excluded.property_types,
 max_price_cents=excluded.max_price_cents,max_repairs_cents=excluded.max_repairs_cents,daily_emails=excluded.daily_emails,
 paused=false,consent_at=now(),expires_at=now()+interval '30 days',updated_at=now() returning * into b;
 insert into public.icash_network_consents(buyer_id,action,version,consent_text,preferences)
 values(b.id,'enrolled',b.consent_version,public.icash_network_consent_text(),p_profile-'accepted');
 -- Wake only existing signed-deal jobs in the requested ZIPs. No provider calls here.
 update public.icash_fulfillment_jobs j set state='ready',updated_at=now()
 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id
 where j.deal_id=d.id and j.account_id=d.account_id and j.state='complete'
 and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and s.snapshot->'raw'->'data'->>'zip'=any(b.zips) and public.icash_vip_active(j.account_id);
 return b.id;
end $$;

create function public.icash_network_pause(p_user uuid,p_token text default null) returns void language plpgsql set search_path='' as $$
declare b public.icash_network_buyers;
begin
 select * into b from public.icash_network_buyers where
 (p_user is not null and user_id=p_user) or (p_user is null and p_token ~ '^[a-f0-9]{32}$' and unsubscribe_token=p_token) for update;
 if not found or b.paused then return;end if;
 update public.icash_network_buyers set paused=true,updated_at=now() where id=b.id;
 insert into public.icash_network_consents(buyer_id,action,version,consent_text,preferences)
 values(b.id,'paused',b.consent_version,'Network emails stopped.','{}');
end $$;

-- Eligibility is rechecked at matching, reading, queuing and immediately before sending.
create function public.icash_network_deal_current(p_account uuid,p_deal uuid) returns boolean language sql stable set search_path='' as $$
 select public.icash_vip_active(p_account) and exists(
 select 1 from public.icash_deal_files d
 join public.icash_accounts a on a.id=d.account_id and not a.bot_paused
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 join public.icash_disposition_authorities da on da.deal_id=d.id and da.account_id=d.account_id and da.expires_at>now()
 join public.icash_signing_envelopes e on e.id=da.purchase_envelope_id and e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and e.state='completed' and not e.test_mode
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and coalesce(d.terms->>'practice','false')='false' and s.snapshot->'raw'->'data'->>'zip' ~ '^[0-9]{5}$'
 and not exists(select 1 from public.icash_network_settings ns where ns.account_id=p_account and not ns.enabled)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not public.icash_buyer_outreach_held(p_account,p_deal) and not public.icash_buyer_is_reserved(p_account,p_deal)
 and public.icash_buyer_package_data(p_account,p_deal) is not null
 and exists(select 1 from public.icash_buyer_package_links l where l.account_id=p_account and l.deal_id=p_deal and l.purchase_envelope_id=e.id and l.revoked_at is null and l.asking_price_cents=da.asking_price_cents));
$$;

create function public.icash_network_match_current(p_match uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_network_matches m
 join public.icash_network_buyers b on b.id=m.buyer_id and not b.paused and b.expires_at>now()
 join auth.users u on u.id=b.user_id and u.email_confirmed_at is not null and lower(trim(u.email))=b.email
 join public.icash_deal_files d on d.id=m.deal_id and d.account_id=m.account_id
 join public.icash_screening_jobs s on s.id=d.screening_id
 join public.icash_disposition_authorities da on da.deal_id=d.id and da.account_id=d.account_id
 where m.id=p_match and m.state<>'passed' and public.icash_network_deal_current(m.account_id,m.deal_id)
 and b.zips @> array[s.snapshot->'raw'->'data'->>'zip'] and da.property_type=any(b.property_types)
 and da.asking_price_cents<=b.max_price_cents and da.repairs_cents<=b.max_repairs_cents
 and not exists(select 1 from public.icash_email_suppressions es where es.email=b.email));
$$;

create function public.icash_network_match_deal(p_account uuid,p_deal uuid) returns integer language plpgsql set search_path='' as $$
declare d public.icash_deal_files;s public.icash_screening_jobs;a public.icash_disposition_authorities;n integer;property text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_deal::text,9821));
 if not public.icash_network_deal_current(p_account,p_deal) then return 0;end if;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account;
 select * into strict s from public.icash_screening_jobs where id=d.screening_id;
 select * into strict a from public.icash_disposition_authorities where deal_id=p_deal and account_id=p_account;
 property:=(s.snapshot->'raw'->'data'->>'zip')||':'||regexp_replace(lower(d.terms->>'address'),'[^a-z0-9]','','g');
 if length(property)<10 then return 0;end if;
 insert into public.icash_network_matches(account_id,deal_id,buyer_id,property_key)
 select p_account,p_deal,b.id,property from public.icash_network_buyers b
 join auth.users u on u.id=b.user_id and u.email_confirmed_at is not null and lower(trim(u.email))=b.email
 where not b.paused and b.expires_at>now() and b.zips @> array[s.snapshot->'raw'->'data'->>'zip']
 and a.property_type=any(b.property_types) and a.asking_price_cents<=b.max_price_cents and a.repairs_cents<=b.max_repairs_cents
 and not exists(select 1 from public.icash_accounts own where own.id=p_account and own.owner_user_id=b.user_id)
 and not exists(select 1 from public.icash_email_suppressions es where es.email=b.email)
 and not exists(select 1 from public.icash_network_matches old where old.buyer_id=b.id and old.property_key=property)
 order by b.updated_at desc,b.id limit 50 on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;

create function public.icash_network_profile(p_user uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('name',b.name,'email',b.email,'zips',b.zips,'propertyTypes',b.property_types,'maxPriceCents',b.max_price_cents,
 'maxRepairsCents',b.max_repairs_cents,'dailyEmails',b.daily_emails,'paused',b.paused,'expiresAt',b.expires_at)
 from public.icash_network_buyers b where b.user_id=p_user;
$$;

create function public.icash_network_inbox(p_user uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(x.row order by x.created_at desc),'[]') from (
 select m.created_at,jsonb_build_object('id',m.id,'state',m.state,'address',d.terms->>'address','askingPriceCents',l.asking_price_cents,
 'url','https://homeoffernetwork.com/d/'||l.token,'createdAt',m.created_at) row
 from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id
 join public.icash_deal_files d on d.id=m.deal_id and d.account_id=m.account_id
 join public.icash_disposition_authorities a on a.deal_id=d.id and a.account_id=d.account_id
 join public.icash_buyer_package_links l on l.deal_id=d.id and l.account_id=d.account_id and l.revoked_at is null and l.purchase_envelope_id=a.purchase_envelope_id and l.asking_price_cents=a.asking_price_cents
 where b.user_id=p_user and public.icash_network_match_current(m.id) order by m.created_at desc limit 50) x;
$$;

create function public.icash_network_respond(p_user uuid,p_match uuid,p_state text) returns void language plpgsql set search_path='' as $$
begin
 if p_state not in ('interested','passed') or not exists(select 1 from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id where m.id=p_match and b.user_id=p_user)
 or not public.icash_network_match_current(p_match) then raise exception 'Match unavailable';end if;
 update public.icash_network_matches set state=p_state,responded_at=now() where id=p_match;
end $$;

create function public.icash_network_save_settings(p_account uuid,p_user uuid,p_enabled boolean,p_address text) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) or not public.icash_vip_active(p_account) then raise exception 'Active VIP required';end if;
 insert into public.icash_network_settings(account_id,enabled,mailing_address) values(p_account,p_enabled,trim(p_address))
 on conflict(account_id) do update set enabled=excluded.enabled,mailing_address=excluded.mailing_address,updated_at=now();
 if p_enabled then update public.icash_fulfillment_jobs set state='ready',updated_at=now() where account_id=p_account and state='complete';end if;
end $$;

create function public.icash_network_ack_response(p_account uuid,p_user uuid,p_match uuid) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account owner required';end if;
 update public.icash_network_matches set reviewed_at=now() where id=p_match and account_id=p_account and state in ('interested','replied');
 if not found then raise exception 'Buyer response unavailable';end if;
end $$;
revoke all on function public.icash_network_ack_response(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_network_ack_response(uuid,uuid,uuid) to service_role;

create function public.icash_network_workspace(p_account uuid,p_deal uuid default null) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('vip',public.icash_vip_active(p_account),
 'enrolledBuyers',(select count(*) from public.icash_network_buyers b join auth.users u on u.id=b.user_id and lower(trim(u.email))=b.email and u.email_confirmed_at is not null where not b.paused and b.expires_at>now() and not exists(select 1 from public.icash_email_suppressions es where es.email=b.email)),
 'settings',(select jsonb_build_object('enabled',enabled,'mailingAddress',mailing_address) from public.icash_network_settings where account_id=p_account),
 'matches',(select count(*) from public.icash_network_matches where account_id=p_account and (p_deal is null or deal_id=p_deal)),
 'emailed',(select count(*) from public.icash_network_matches m join public.icash_deal_emails e on e.id=m.email_id where m.account_id=p_account and (p_deal is null or m.deal_id=p_deal) and e.state='accepted'),
 'interested',(select count(*) from public.icash_network_matches where account_id=p_account and (p_deal is null or deal_id=p_deal) and state='interested'),
 'responses',(select count(*) from public.icash_network_matches where account_id=p_account and (p_deal is null or deal_id=p_deal) and state in ('interested','replied') and responded_at>coalesce(reviewed_at,'-infinity'::timestamptz)),
 'buyers',coalesce((select jsonb_agg(x.row) from (select jsonb_build_object('id',m.id,'dealId',m.deal_id,'name',b.name,'email',b.email,'address',d.terms->>'address','respondedAt',m.responded_at,'state',m.state,
 'reply',(select left(e.body_text,800) from public.icash_deal_emails e where e.account_id=m.account_id and e.deal_id=m.deal_id and e.direction='incoming' and e.contact_key='network:'||m.id order by e.created_at desc limit 1)) row
 from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id join public.icash_deal_files d on d.id=m.deal_id and d.account_id=m.account_id
 where m.account_id=p_account and (p_deal is null or m.deal_id=p_deal) and m.state in ('interested','replied') and m.responded_at>coalesce(m.reviewed_at,'-infinity'::timestamptz)
 order by m.responded_at desc limit 20) x),'[]'));
$$;

alter function public.icash_deal_email_contacts(uuid,uuid) rename to icash_email_contacts_before_network;
create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz) language sql stable set search_path='' as $$
 select * from public.icash_email_contacts_before_network(p_account,p_deal)
 union all
 select 'network:'||m.id,b.email,b.name,'buyer',least(b.expires_at,a.expires_at)
 from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id
 join public.icash_disposition_authorities a on a.deal_id=m.deal_id and a.account_id=m.account_id
 join public.icash_network_settings ns on ns.account_id=m.account_id and ns.enabled
 where m.account_id=p_account and m.deal_id=p_deal and public.icash_network_match_current(m.id);
$$;

create function public.icash_network_email_content(p_match uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare m public.icash_network_matches;b public.icash_network_buyers;c jsonb;address text;unsubscribe text;
begin
 select * into m from public.icash_network_matches where id=p_match;
 if not found or not public.icash_network_match_current(m.id) then return null;end if;
 select * into strict b from public.icash_network_buyers where id=m.buyer_id;
 select mailing_address into address from public.icash_network_settings where account_id=m.account_id and enabled;
 if address is null then return null;end if;
 c:=public.icash_buyer_outreach_content(m.account_id,m.deal_id);if c is null then return null;end if;
 unsubscribe:='https://homeoffernetwork.com/buyers/unsubscribe/'||b.unsubscribe_token;
 return jsonb_build_object('subject',c->>'subject','body',(c->>'email')||E'\n\nYou requested matching off-market packages through HomeOffer Network. Interested? Reply to this email or open your matches: https://homeoffernetwork.com/buyers\n\n'||address||E'\nStop network emails: '||unsubscribe,'unsubscribeUrl',unsubscribe);
end $$;

create function public.icash_network_queue_email(p_account uuid,p_match uuid) returns uuid language plpgsql set search_path='' as $$
declare m public.icash_network_matches;b public.icash_network_buyers;c jsonb;rate uuid;actor uuid;n uuid;
begin
 select * into m from public.icash_network_matches where id=p_match and account_id=p_account for update;
 if not found or m.state<>'matched' then return null;end if;
 if m.email_id is not null then return m.email_id;end if;
 select * into b from public.icash_network_buyers where id=m.buyer_id for update;
 c:=public.icash_network_email_content(m.id);if c is null then return null;end if;
 if (select count(*) from public.icash_network_matches nm join public.icash_deal_emails e on e.id=nm.email_id where nm.buyer_id=b.id and e.created_at>now()-interval '24 hours' and e.state in ('ready','dispatching','accepted','needs_review'))>=b.daily_emails then return null;end if;
 -- Do not send a second package already requested through another account-local path.
 if exists(select 1 from public.icash_deal_emails e where e.account_id=p_account and e.deal_id=m.deal_id and lower(e.recipient)=b.email and e.direction='outgoing' and e.contact_key like 'buyer-request:%' and e.state in ('ready','dispatching','accepted','needs_review')) then return null;end if;
 select id into rate from public.icash_operation_rates where operation='manual_email' and enabled and verified_at<=now() and expires_at>now() order by verified_at desc limit 1;
 if rate is null then return null;end if;
 select owner_user_id into actor from public.icash_accounts where id=p_account;
 n:=public.icash_queue_deal_email(p_account,actor,m.deal_id,'network:'||m.id,m.id,c->>'subject',c->>'body',rate);
 update public.icash_network_matches set email_id=n where id=m.id;return n;
end $$;

create function public.icash_network_email_targets(p_account uuid,p_deal uuid) returns table(id uuid) language sql stable set search_path='' as $$
 select m.id from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id
 join public.icash_network_settings ns on ns.account_id=m.account_id and ns.enabled
 left join public.icash_deal_emails e on e.id=m.email_id
 where m.account_id=p_account and m.deal_id=p_deal and m.state='matched' and (m.email_id is null or e.state='ready')
 and public.icash_network_match_current(m.id)
 and (select count(*) from public.icash_network_matches nm join public.icash_deal_emails sent on sent.id=nm.email_id where nm.buyer_id=b.id and nm.id<>m.id and sent.created_at>now()-interval '24 hours' and sent.state in ('ready','dispatching','accepted','needs_review'))<b.daily_emails
 order by m.created_at,m.id limit 3;
$$;
revoke all on function public.icash_network_email_targets(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_network_email_targets(uuid,uuid) to service_role;

alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_email_before_network;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare e public.icash_deal_emails;m public.icash_network_matches;b public.icash_network_buyers;c jsonb;result jsonb;
begin
 select * into e from public.icash_deal_emails where id=p_id and account_id=p_account;
 if e.contact_key like 'network:%' then
  select * into m from public.icash_network_matches where id::text=substring(e.contact_key from 9) and account_id=p_account and deal_id=e.deal_id;
  if not found then return null;end if;
  select * into b from public.icash_network_buyers where id=m.buyer_id for update;
  if not public.icash_network_match_current(m.id) then return null;end if;
  if m.email_id=e.id then
   c:=public.icash_network_email_content(m.id);
   if c is null or e.subject is distinct from c->>'subject' or e.body_text is distinct from c->>'body' then return null;end if;
   if (select count(*) from public.icash_network_matches nm join public.icash_deal_emails sent on sent.id=nm.email_id where nm.buyer_id=b.id and sent.id<>e.id and sent.updated_at>now()-interval '24 hours' and sent.state in ('dispatching','accepted','needs_review'))>=b.daily_emails then return null;end if;
  elsif m.state not in ('interested','replied') then return null;
  end if;
  if e.body_text ~* '(underlying purchase price|assignment fee)\s*:|includes the \$[0-9][0-9,.]* assignment fee' then return null;end if;
  result:=public.icash_claim_email_before_network(p_account,p_id);
  if result is not null then return result||jsonb_build_object('unsubscribeUrl','https://homeoffernetwork.com/buyers/unsubscribe/'||b.unsubscribe_token);end if;
  return null;
 end if;
 return public.icash_claim_email_before_network(p_account,p_id);
end $$;

create function public.icash_network_record_reply() returns trigger language plpgsql set search_path='' as $$
begin
 if new.direction='incoming' and new.contact_key like 'network:%' then
  update public.icash_network_matches set state=case when state='interested' then state else 'replied' end,responded_at=now()
  where id::text=substring(new.contact_key from 9) and account_id=new.account_id and deal_id=new.deal_id;
 end if;
 return new;
end $$;
create trigger icash_network_record_reply after insert on public.icash_deal_emails for each row execute function public.icash_network_record_reply();
revoke all on function public.icash_network_record_reply() from public,anon,authenticated;
grant execute on function public.icash_network_record_reply() to service_role;

-- Continue small delivery batches through the existing durable fulfillment worker.
alter function public.icash_queue_fulfillment() rename to icash_queue_fulfillment_before_network;
create function public.icash_queue_fulfillment() returns void language plpgsql set search_path='' as $$
begin
 perform public.icash_queue_fulfillment_before_network();
 update public.icash_fulfillment_jobs j set state='ready',updated_at=now()
 where j.state='complete' and j.updated_at<now()-interval '5 minutes'
 and j.result->'buyerNetwork'->>'canContinue'='true' and public.icash_vip_active(j.account_id);
end $$;

revoke all on function public.icash_network_consent_text(),public.icash_network_save_buyer(uuid,jsonb),public.icash_network_pause(uuid,text),public.icash_network_deal_current(uuid,uuid),public.icash_network_match_current(uuid),public.icash_network_match_deal(uuid,uuid),public.icash_network_profile(uuid),public.icash_network_inbox(uuid),public.icash_network_respond(uuid,uuid,text),public.icash_network_save_settings(uuid,uuid,boolean,text),public.icash_network_workspace(uuid,uuid),public.icash_network_email_content(uuid),public.icash_network_queue_email(uuid,uuid),public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_deal_email(uuid,uuid),public.icash_queue_fulfillment() from public,anon,authenticated;
grant execute on function public.icash_network_consent_text(),public.icash_network_save_buyer(uuid,jsonb),public.icash_network_pause(uuid,text),public.icash_network_deal_current(uuid,uuid),public.icash_network_match_current(uuid),public.icash_network_match_deal(uuid,uuid),public.icash_network_profile(uuid),public.icash_network_inbox(uuid),public.icash_network_respond(uuid,uuid,text),public.icash_network_save_settings(uuid,uuid,boolean,text),public.icash_network_workspace(uuid,uuid),public.icash_network_email_content(uuid),public.icash_network_queue_email(uuid,uuid),public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_deal_email(uuid,uuid),public.icash_queue_fulfillment() to service_role;
commit;
