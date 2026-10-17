begin;
-- A phone challenge proves possession of the phone on one settled purchase.
-- It never marks an email verified or claims other purchases sharing that email.
create function public.icash_access_phone(p_phone text) returns text language sql immutable security invoker set search_path='' as $$
 select case when n ~ '^\+[1-9][0-9]{7,14}$' then n when n ~ '^[0-9]{10}$' then '+1'||n when n ~ '^1[0-9]{10}$' then '+'||n else null end
 from (select regexp_replace(coalesce(p_phone,''),'[ ()-]','','g') n) x;
$$;
create table public.icash_purchase_phone_identities(
 user_id uuid primary key references auth.users(id), membership_id uuid not null unique references public.icash_memberships(id),
 email text not null, phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'),
 verified_at timestamptz not null default now(),revoked_at timestamptz
);
create table public.icash_purchase_phone_challenges(
 id uuid primary key, membership_id uuid not null references public.icash_memberships(id),email text not null,phone text not null,
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 sender text not null, status text not null default 'pending' check(status in ('pending','sending','sent','unknown','failed','verified','used')),
 attempts integer not null default 0 check(attempts between 0 and 5),provider_id text,
 requested_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',verified_at timestamptz,used_at timestamptz
);
create index icash_phone_challenges_contact on public.icash_purchase_phone_challenges(phone,requested_at desc);
create table public.icash_purchase_phone_sessions(
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),user_id uuid not null references auth.users(id),
 challenge_id uuid not null unique references public.icash_purchase_phone_challenges(id),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days',revoked_at timestamptz
);
alter table public.icash_purchase_phone_identities enable row level security;
alter table public.icash_purchase_phone_challenges enable row level security;
alter table public.icash_purchase_phone_sessions enable row level security;
revoke all on public.icash_purchase_phone_identities,public.icash_purchase_phone_challenges,public.icash_purchase_phone_sessions from public,anon,authenticated;
grant select,insert,update on public.icash_purchase_phone_identities,public.icash_purchase_phone_challenges,public.icash_purchase_phone_sessions to service_role;
grant select(banned_until,deleted_at) on auth.users to service_role;

create function public.icash_phone_access_target(p_email text,p_phone text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('membershipId',m.id,'email',lower(trim(m.payer_email)),'phone',public.icash_access_phone(m.payer_phone),'userId',u.id)
 from public.icash_memberships m
 left join auth.users u on lower(u.email)=lower(trim(m.payer_email))
 left join public.icash_accounts a on a.id=m.account_id
 left join public.icash_purchase_phone_identities identity on identity.user_id=a.owner_user_id and identity.membership_id=m.id and identity.revoked_at is null
 where lower(trim(m.payer_email))=lower(trim(p_email)) and public.icash_access_phone(m.payer_phone)=public.icash_access_phone(p_phone)
 and public.icash_access_phone(p_phone) is not null and m.mode='live'
 and (u.id is null or u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 and exists(select 1 from public.icash_membership_invoices i where i.membership_id=m.id and i.amount_cents>0)
 and ((m.account_id is null and m.state='active' and m.paid_through>now()
  and (u.id is null or u.email_confirmed_at is null and not exists(select 1 from public.icash_accounts existing where existing.owner_user_id=u.id))
  and not exists(select 1 from public.icash_billing_reviews r join public.icash_membership_invoices i on i.stripe_payment_id=r.payment_id where i.membership_id=m.id and r.resolved_at is null))
  or (identity.user_id=u.id and identity.phone=public.icash_access_phone(m.payer_phone) and identity.email=lower(trim(m.payer_email))))
 -- Recovery requests do not override STOP or a manual transport disable.
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=public.icash_access_phone(p_phone))
 and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=public.icash_access_phone(p_phone))
 and exists(select 1 from public.icash_messaging_settings where id=1 and config->>'smsEnabled'='true')
 order by m.created_at desc limit 1;
$$;
create function public.icash_begin_phone_challenge(p_id uuid,p_email text,p_phone text,p_secret_hash text,p_code_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare target jsonb;number text;sender_phone text;
begin
 if p_id is null or p_secret_hash is null or p_code_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid challenge';end if;
 number:=public.icash_access_phone(p_phone);if number is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(number,81717));
 if exists(select 1 from public.icash_purchase_phone_challenges where phone=number and requested_at>now()-interval '60 seconds')
 or (select count(*) from public.icash_purchase_phone_challenges where phone=number and requested_at>now()-interval '10 minutes')>=3 then return null;end if;
 target:=public.icash_phone_access_target(p_email,number);if target is null then return null;end if;
 sender_phone:=public.icash_webinar_campaign_sender(number);if sender_phone is null then return null;end if;
 update public.icash_purchase_phone_challenges set expires_at=now() where phone=number and used_at is null and expires_at>now();
 insert into public.icash_purchase_phone_challenges(id,membership_id,email,phone,secret_hash,code_hash,sender)
 values(p_id,(target->>'membershipId')::uuid,target->>'email',number,p_secret_hash,p_code_hash,sender_phone);
 return jsonb_build_object('id',p_id,'phone',number,'sender',sender_phone);
end $$;
create function public.icash_authorize_phone_challenge(p_id uuid,p_secret_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.icash_purchase_phone_challenges;target jsonb;
begin
 select * into c from public.icash_purchase_phone_challenges where id=p_id and secret_hash=p_secret_hash for update;
 if c.id is null or c.status<>'pending' or c.expires_at<=now() then return false;end if;
 target:=public.icash_phone_access_target(c.email,c.phone);
 if target is null or target->>'membershipId'<>c.membership_id::text or public.icash_webinar_campaign_sender(c.phone) is distinct from c.sender then return false;end if;
 update public.icash_purchase_phone_challenges set status='sending' where id=c.id;return true;
end $$;
create function public.icash_finish_phone_challenge(p_id uuid,p_secret_hash text,p_provider text default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_purchase_phone_challenges set status=case when p_provider is null then 'unknown' else 'sent' end,provider_id=left(p_provider,200)
 where id=p_id and secret_hash=p_secret_hash and status='sending';
end $$;
create function public.icash_verify_phone_challenge(p_id uuid,p_secret_hash text,p_code_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_purchase_phone_challenges;target jsonb;
begin
 select * into c from public.icash_purchase_phone_challenges where id=p_id and secret_hash=p_secret_hash for update;
 if c.id is null or c.expires_at<=now() or c.used_at is not null or c.attempts>=5 or c.status not in ('sending','sent','unknown','verified') then return null;end if;
 if c.code_hash is distinct from p_code_hash then update public.icash_purchase_phone_challenges set attempts=attempts+1 where id=c.id;return null;end if;
 target:=public.icash_phone_access_target(c.email,c.phone);
 if target is null or target->>'membershipId'<>c.membership_id::text then return null;end if;
 update public.icash_purchase_phone_challenges set status='verified',verified_at=coalesce(verified_at,now()) where id=c.id;
 return target;
end $$;
create function public.icash_complete_phone_access(p_id uuid,p_secret_hash text,p_user uuid,p_session_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.icash_purchase_phone_challenges;m public.icash_memberships;target jsonb;a uuid;
begin
 if p_user is null or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into c from public.icash_purchase_phone_challenges where id=p_id and secret_hash=p_secret_hash for update;
 if c.id is null or c.status<>'verified' or c.verified_at is null or c.expires_at<=now() or c.used_at is not null then return false;end if;
 select * into m from public.icash_memberships where id=c.membership_id for update;
 target:=public.icash_phone_access_target(c.email,c.phone);
 if target is null or target->>'membershipId'<>c.membership_id::text or target->>'userId' is distinct from p_user::text then return false;end if;
 select id into a from public.icash_accounts where owner_user_id=p_user;
 if m.account_id is null then
  if a is not null or exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then return false;end if;
  a:=public.icash_create_account(p_user);
  update public.icash_memberships set account_id=a where id=m.id and account_id is null;
  update public.icash_accounts set billing_model='membership_credits' where id=a;
  if not exists(select 1 from public.icash_bot_setups where account_id=a) then
   update public.icash_bot_setups set account_id=a where id=(select id from public.icash_bot_setups where guest_hash=m.guest_hash and account_id is null order by created_at desc limit 1);
  end if;
  insert into public.icash_purchase_phone_identities(user_id,membership_id,email,phone) values(p_user,m.id,c.email,c.phone);
 elsif m.account_id is distinct from a then return false;end if;
 insert into public.icash_purchase_phone_sessions(token_hash,user_id,challenge_id) values(p_session_hash,p_user,c.id);
 update public.icash_purchase_phone_challenges set status='used',used_at=now() where id=c.id;
 return true;
end $$;
create function public.icash_phone_session_user(p_hash text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',u.id,'email',u.email,'email_confirmed_at',u.email_confirmed_at,'phone_verified',true)
 from public.icash_purchase_phone_sessions s join public.icash_purchase_phone_identities i on i.user_id=s.user_id and i.revoked_at is null
 join auth.users u on u.id=s.user_id join public.icash_accounts a on a.owner_user_id=u.id
 join public.icash_memberships m on m.id=i.membership_id and m.account_id=a.id and m.mode='live'
 where s.token_hash=p_hash and s.expires_at>now() and s.revoked_at is null and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now()) and lower(u.email)=i.email and public.icash_access_phone(m.payer_phone)=i.phone;
$$;
create function public.icash_revoke_phone_session(p_hash text) returns void language sql security invoker set search_path='' as $$
 update public.icash_purchase_phone_sessions set revoked_at=now() where token_hash=p_hash and revoked_at is null;
$$;

-- Existing workspace loading reuses its own account only for phone identities.
-- The email-authenticated path retains its existing verified-email claim rules.
do $migration$
declare definition text;needle text:='if email_address is null then raise exception ''Verified email required''; end if;';
begin
 select pg_get_functiondef('public.icash_claim_funding(uuid,text)'::regprocedure) into definition;
 if position(needle in definition)=0 then raise exception 'Unexpected funding claim definition';end if;
 definition:=replace(definition,needle,$branch$
 if email_address is null then
  select ac.id into a from public.icash_accounts ac join public.icash_purchase_phone_identities pi on pi.user_id=ac.owner_user_id and pi.revoked_at is null
  join auth.users au on au.id=pi.user_id and lower(au.email)=pi.email
  where ac.owner_user_id=p_user and p_mode='live' and au.deleted_at is null and (au.banned_until is null or au.banned_until<=now());
  if a is null then raise exception 'Verified identity required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  for o in select * from public.icash_funding_orders where account_id=a and mode=p_mode and state='paid' and credited_at is null order by id for update loop
   perform public.icash_post_credit(a,'stripe-funding:'||o.id,'purchase',o.credit_cents,o.stripe_payment_id);
   update public.icash_funding_orders set credited_at=now() where id=o.id;
  end loop;
  update public.icash_billing_reviews r set account_id=a from public.icash_funding_orders f where r.payment_id=f.stripe_payment_id and f.account_id=a and r.account_id is null;
  if exists(select 1 from public.icash_billing_reviews where account_id=a and resolved_at is null) then update public.icash_accounts set bot_paused=true where id=a;end if;
  return a;
 end if;
 $branch$);
 execute definition;
end $migration$;

-- Transactional permission recorded from the completed checkout, not webinar marketing permission.
create table public.icash_purchase_access_contacts(
 membership_id uuid primary key references public.icash_memberships(id),checkout_id text not null,phone text not null,
 version text not null check(version='purchase-access-sms-2026-10-17'),recorded_at timestamptz not null default now()
);
alter table public.icash_purchase_access_contacts enable row level security;
revoke all on public.icash_purchase_access_contacts from public,anon,authenticated;
grant select,insert on public.icash_purchase_access_contacts to service_role;
alter table public.icash_purchase_access_followups add column checkout_permission boolean not null default false;
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.icash_purchase_access_followups'::regclass and contype='c' and pg_get_constraintdef(oid) like '%visitor_id IS NOT NULL%' loop
  execute format('alter table public.icash_purchase_access_followups drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.icash_purchase_access_followups add constraint icash_access_followup_recipient check(
 channel='email' and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or channel='sms' and (visitor_id is not null or checkout_permission) and recipient ~ '^\+[1-9][0-9]{7,14}$');
create function public.icash_record_purchase_access_contact(p_membership uuid,p_checkout text,p_phone text,p_version text) returns void language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;number text;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 number:=public.icash_access_phone(p_phone);
 if m.id is null or m.mode<>'live' or m.state<>'active' or m.paid_through<=now() or m.stripe_session_id is distinct from p_checkout
 or p_version is distinct from 'purchase-access-sms-2026-10-17' or number is null or public.icash_access_phone(m.payer_phone) is distinct from number
 or not exists(select 1 from public.icash_membership_invoices where membership_id=m.id and amount_cents>0) then raise exception 'Checkout contact mismatch';end if;
 insert into public.icash_purchase_access_contacts(membership_id,checkout_id,phone,version) values(m.id,p_checkout,number,p_version) on conflict do nothing;
 -- A checkout can finish after its invoice webhook; the queue is still unique.
 insert into public.icash_purchase_access_followups(purchase_email_id,membership_id,channel,recipient,due_at,next_attempt_at,checkout_permission)
 select e.id,m.id,'sms',number,now(),now(),true from public.icash_purchase_access_emails e
 where e.membership_id=m.id and e.created_at>now()-interval '3 days'
 and exists(select 1 from public.icash_purchase_access_contacts c where c.membership_id=m.id and c.phone=number and c.checkout_id=p_checkout)
 on conflict(membership_id,channel) do nothing;
end $$;
create or replace function public.icash_purchase_access_followup_allowed(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_purchase_access_followups f
 join public.icash_purchase_access_emails e on e.id=f.purchase_email_id and e.membership_id=f.membership_id
 join public.icash_memberships m on m.id=f.membership_id
 join public.icash_membership_invoices i on i.stripe_invoice_id=e.invoice_id and i.membership_id=m.id
 where f.id=p_id and m.mode='live' and m.state='active' and m.paid_through>now() and i.amount_cents>0
 and lower(trim(m.payer_email))=e.recipient
 and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=i.stripe_payment_id and r.resolved_at is null)
 and case when f.channel='email' then m.account_id is null and f.recipient=e.recipient
 and e.status='sent' and e.provider_id is not null and public.icash_purchase_email_allowed(e.id)
 else ((not f.checkout_permission and public.icash_purchase_text_contact(m.id,f.visitor_id)
  and exists(select 1 from public.icash_webinar_visitors v where v.id=f.visitor_id and v.phone=f.recipient))
 or (f.checkout_permission and exists(select 1 from public.icash_purchase_access_contacts c where c.membership_id=m.id
  and c.phone=f.recipient and c.checkout_id=m.stripe_session_id and c.phone=public.icash_access_phone(m.payer_phone))))
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=f.recipient)
 and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=f.recipient)
 and exists(select 1 from public.icash_messaging_settings where id=1 and config->>'smsEnabled'='true') end);
$$;
revoke all on function public.icash_access_phone(text),public.icash_phone_access_target(text,text),public.icash_begin_phone_challenge(uuid,text,text,text,text),public.icash_authorize_phone_challenge(uuid,text),public.icash_finish_phone_challenge(uuid,text,text),public.icash_verify_phone_challenge(uuid,text,text),public.icash_complete_phone_access(uuid,text,uuid,text),public.icash_phone_session_user(text),public.icash_revoke_phone_session(text),public.icash_record_purchase_access_contact(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_access_phone(text),public.icash_phone_access_target(text,text),public.icash_begin_phone_challenge(uuid,text,text,text,text),public.icash_authorize_phone_challenge(uuid,text),public.icash_finish_phone_challenge(uuid,text,text),public.icash_verify_phone_challenge(uuid,text,text),public.icash_complete_phone_access(uuid,text,uuid,text),public.icash_phone_session_user(text),public.icash_revoke_phone_session(text),public.icash_record_purchase_access_contact(uuid,text,text,text) to service_role;
commit;
