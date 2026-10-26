begin;
-- Isolated legacy offer; never edits an existing price, subscription or balance.
-- paid_through is the existing access-until boundary, not evidence of payment.
alter table public.icash_memberships
 add column legacy_trial_offer text,
 add column legacy_trial_end timestamptz,
 add column legacy_trial_started_at timestamptz,
 add column legacy_trial_attempt integer not null default 1 check(legacy_trial_attempt>0),
 add constraint icash_legacy_trial_shape check (coalesce((
  (legacy_trial_offer is null and legacy_trial_end is null and legacy_trial_started_at is null)
  or (legacy_trial_offer='legacy-trial-2026-10-25.1' and legacy_trial_end is not null
   and (legacy_trial_started_at is not null or price_cents=5000) and initial_price_cents=0
   and consent_version='legacy-trial-2026-10-25.1' and checkout_email is not null)),false));
create unique index icash_legacy_trial_email_once on public.icash_memberships(lower(checkout_email),mode)
 where legacy_trial_offer is not null and (state<>'cancelled' or legacy_trial_started_at is not null);

create function public.icash_begin_legacy_trial(p_guest text,p_account uuid,p_mode text,p_email text,p_terms text,p_version text)
returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;em text:=lower(trim(p_email));rev integer;
begin
 if p_guest is null or p_guest !~ '^[a-f0-9]{64}$' or p_mode is null or p_mode not in ('test','live')
 or em is null or length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 or p_terms is null or length(p_terms) not between 20 and 4000 or p_version is distinct from 'legacy-trial-2026-10-25.1'
 then raise exception 'Legacy offer unavailable';end if;
 -- Same reservation lock as ordinary checkout: two browsers cannot create two offers.
 perform pg_advisory_xact_lock(hashtextextended('membership-email:'||p_mode||':'||em,0));
 perform pg_advisory_xact_lock(hashtextextended(p_guest||':'||p_mode,612));
 if p_account is not null then
  perform 1 from public.icash_accounts a join auth.users u on u.id=a.owner_user_id
   where a.id=p_account and lower(trim(u.email))=em and u.email_confirmed_at is not null for update of a;
  if not found then raise exception 'Legacy offer unavailable';end if;
  if exists(select 1 from public.icash_daily_plans where account_id=p_account and mode=p_mode and state<>'stopped')
   or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  then raise exception 'Legacy offer unavailable';end if;
 end if;
 -- This reusable owner-distributed offer does not invent a historical customer
 -- identity gate. Email reserves one trial; it never authenticates account access.
 select * into m from public.icash_memberships where mode=p_mode and legacy_trial_offer='legacy-trial-2026-10-25.1'
  and (state<>'cancelled' or legacy_trial_started_at is not null)
  and (checkout_email=em or lower(trim(payer_email))=em)
  order by created_at,id limit 1 for update;
 if found then
  if m.state='pending' and m.legacy_trial_started_at is null and m.account_id is not distinct from p_account
   and m.guest_hash=p_guest and m.checkout_email=em and m.consent_text=p_terms
  then return m;end if;
  raise exception 'Legacy offer unavailable';
 end if;
 if exists(select 1 from public.icash_memberships where mode=p_mode and state<>'cancelled'
  and (guest_hash=p_guest or (p_account is not null and account_id=p_account) or checkout_email=em or lower(trim(payer_email))=em))
 then raise exception 'Legacy offer unavailable';end if;
 select revision into rev from public.icash_membership_offer where id=1 and enabled for share;
 if rev is null then raise exception 'Legacy offer unavailable';end if;
 insert into public.icash_memberships(guest_hash,account_id,mode,price_cents,initial_price_cents,offer_revision,
  consent_version,consent_text,checkout_email,checkout_email_reserved_until,legacy_trial_offer,legacy_trial_end)
 values(p_guest,p_account,p_mode,5000,0,rev,p_version,p_terms,em,now()+interval '25 hours',p_version,
  (date_trunc('second',now() at time zone 'UTC')+interval '2 months') at time zone 'UTC') returning * into m;
 return m;
end $$;

-- Lost-cookie recovery authenticates through Auth's verified email, never the
-- invitation, submitted email alone, or knowledge of a Checkout session ID.
create function public.icash_legacy_trial_recovery(p_user uuid,p_mode text,p_email text)
returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;em text:=lower(trim(p_email));
begin
 if p_user is null or p_mode is null or p_mode not in ('test','live') or em is null
 or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and lower(trim(email))=em)
 then raise exception 'Verified purchase email required';end if;
 select * into m from public.icash_memberships where mode=p_mode and checkout_email=em
  and legacy_trial_offer='legacy-trial-2026-10-25.1'
  and (state='pending' or legacy_trial_started_at is not null)
  order by created_at desc,id desc limit 1;
 return m;
end $$;

-- Caller retrieves (and, if open, expires) the exact provider session and verifies
-- terminal expiry before invoking this. Keep the old consent row as immutable history.
create function public.icash_release_legacy_trial_checkout(p_user uuid,p_membership uuid,p_session text)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;
begin
 select * into m from public.icash_memberships where id=p_membership;
 if not found or m.checkout_email is null or p_user is null
 or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and lower(trim(email))=m.checkout_email)
 then raise exception 'Verified purchase email required';end if;
 perform pg_advisory_xact_lock(hashtextextended('membership-email:'||m.mode||':'||m.checkout_email,0));
 select * into m from public.icash_memberships where id=p_membership for update;
 if m.legacy_trial_offer is distinct from 'legacy-trial-2026-10-25.1' or m.state<>'pending'
 or m.legacy_trial_started_at is not null or m.stripe_subscription_id is not null
 or p_session is null or p_session !~ ('^cs_'||m.mode||'_[A-Za-z0-9]+$')
 or m.stripe_session_id is distinct from p_session
 or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and lower(trim(email))=m.checkout_email)
 then raise exception 'Legacy checkout release unavailable';end if;
 update public.icash_memberships set state='cancelled',updated_at=now() where id=m.id and state='pending';
end $$;

-- Caller must first retrieve this exact Stripe session and confirm it expired.
-- Never use this to reset an unknown, completed, trialing or paid checkout.
create function public.icash_restart_legacy_trial(p_membership uuid,p_session text,p_attempt integer)
returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 if not found or m.legacy_trial_offer is distinct from 'legacy-trial-2026-10-25.1'
 or m.state<>'pending' or m.legacy_trial_started_at is not null
 or m.stripe_subscription_id is not null or m.stripe_customer_id is not null
 or p_session is null or p_session !~ ('^cs_'||m.mode||'_[A-Za-z0-9]+$')
 or m.stripe_session_id is distinct from p_session or m.legacy_trial_attempt is distinct from p_attempt
 then raise exception 'Legacy checkout restart unavailable';end if;
 update public.icash_memberships set stripe_session_id=null,checkout_url=null,
  legacy_trial_attempt=legacy_trial_attempt+1,
  legacy_trial_end=(date_trunc('second',now() at time zone 'UTC')+interval '2 months') at time zone 'UTC',
  checkout_email_reserved_until=now()+interval '25 hours',updated_at=now()
 where id=m.id returning * into m;
 return m;
end $$;

create function public.icash_activate_legacy_trial(p_membership uuid,p_session text,p_subscription text,p_customer text,p_email text,p_phone text,p_trial_end timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 if not found or m.legacy_trial_offer is distinct from 'legacy-trial-2026-10-25.1' or m.price_cents<>5000 or m.initial_price_cents<>0
 or m.consent_version<>'legacy-trial-2026-10-25.1' or p_trial_end is distinct from m.legacy_trial_end
 or p_session is null or p_session !~ ('^cs_'||m.mode||'_[A-Za-z0-9]+$') or m.stripe_session_id is distinct from p_session
 or p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9]+$'
 or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$'
 or lower(trim(p_email)) is distinct from m.checkout_email
 or (m.stripe_subscription_id is not null and m.stripe_subscription_id<>p_subscription)
 or (m.stripe_customer_id is not null and m.stripe_customer_id<>p_customer)
 then raise exception 'Legacy trial binding mismatch';end if;
 -- Cancellation/review is a durable stop, never revived by a late webhook.
 if m.state not in ('pending','active') then return;end if;
 if m.legacy_trial_started_at is null and p_trial_end<=now() then raise exception 'Legacy trial expired';end if;
 update public.icash_memberships set stripe_subscription_id=p_subscription,stripe_customer_id=p_customer,
  payer_email=checkout_email,payer_phone=left(p_phone,40),legacy_trial_started_at=coalesce(legacy_trial_started_at,now()),
  paid_through=greatest(paid_through,p_trial_end),state='active',updated_at=now()
 where id=m.id and state in ('pending','active');
 -- No invoice/payment receipt, wallet credit, unpause or paid operation is created.
end $$;
revoke all on function public.icash_legacy_trial_recovery(uuid,text,text),public.icash_release_legacy_trial_checkout(uuid,uuid,text),public.icash_restart_legacy_trial(uuid,text,integer),public.icash_begin_legacy_trial(text,uuid,text,text,text,text),
 public.icash_activate_legacy_trial(uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_legacy_trial_recovery(uuid,text,text),public.icash_release_legacy_trial_checkout(uuid,uuid,text),public.icash_restart_legacy_trial(uuid,text,integer),public.icash_begin_legacy_trial(text,uuid,text,text,text,text),
 public.icash_activate_legacy_trial(uuid,text,text,text,text,text,timestamptz) to service_role;
commit;
