begin;
-- Preserve the original checkout and consent plus the canonical expiry receipt.
-- This is not cancellation of a subscription or evidence of a payment/refund.
create table public.icash_checkout_releases(
 membership_id uuid primary key references public.icash_memberships(id),
 stripe_session_id text not null unique,receipt jsonb not null,
 verified_user_id uuid,created_at timestamptz not null default now()
);
alter table public.icash_checkout_releases enable row level security;
revoke all on public.icash_checkout_releases from public,anon,authenticated;
grant select,insert on public.icash_checkout_releases to service_role;

create function public.icash_ordinary_checkout_recovery(p_guest text,p_user uuid,p_mode text,p_email text)
returns setof public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare em text:=lower(trim(p_email));a uuid;
begin
 if p_guest is null or p_guest !~ '^[a-f0-9]{64}$' or p_mode is null or p_mode not in ('live','test')
 or em is null or em !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(em)>254
 then raise exception 'Checkout recovery unavailable';end if;
 if p_user is not null then
  perform 1 from auth.users where id=p_user and email_confirmed_at is not null and lower(trim(email))=em
   and deleted_at is null and (banned_until is null or banned_until<=now());
  if not found then raise exception 'Verified purchase email required';end if;
  select id into a from public.icash_accounts where owner_user_id=p_user;
 end if;
 -- Never replace an established entitlement, held checkout or consumed trial.
 if exists(select 1 from public.icash_memberships m where m.mode=p_mode
  and (m.guest_hash=p_guest or m.checkout_email=em or lower(trim(m.payer_email))=em or m.account_id=a)
  and ((m.state not in ('pending','cancelled')) or m.stripe_subscription_id is not null or m.paid_through is not null or m.legacy_trial_started_at is not null))
 or exists(select 1 from public.icash_billing_reviews where account_id=a and resolved_at is null)
 or exists(select 1 from public.icash_daily_plans where account_id=a and mode=p_mode and state<>'stopped')
 then return;end if;
 return query select m.* from public.icash_memberships m
 where m.mode=p_mode and m.state='pending' and m.legacy_trial_offer is null
 and m.stripe_subscription_id is null and m.paid_through is null and m.checkout_email=em
 and (m.guest_hash=p_guest or p_user is not null) and (m.account_id is null or m.account_id=a)
 and not exists(select 1 from public.icash_membership_invoices i where i.membership_id=m.id)
 and not exists(select 1 from public.icash_billing_reviews r where r.account_id=m.account_id and r.resolved_at is null)
 order by m.created_at,m.id limit 6;
end $$;

create function public.icash_release_ordinary_checkout(p_guest text,p_user uuid,p_mode text,p_email text,p_membership uuid,p_receipt jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;em text:=lower(trim(p_email));
begin
 if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object'
 or p_receipt->>'status' is distinct from 'expired' or p_receipt->>'mode' is distinct from 'subscription'
 or p_receipt->'livemode' is distinct from to_jsonb(p_mode='live')
 or p_receipt->'subscription' is distinct from 'null'::jsonb or p_receipt->'payment_intent' is distinct from 'null'::jsonb
 or p_receipt->>'membership' is distinct from p_membership::text
 or p_receipt->>'id' is null or p_receipt->>'id' !~ ('^cs_'||p_mode||'_[A-Za-z0-9]+$')
 or (select count(*) from jsonb_object_keys(p_receipt))<>7
 then raise exception 'Canonical expired checkout required';end if;
 perform pg_advisory_xact_lock(hashtextextended('membership-email:'||p_mode||':'||em,0));
 perform pg_advisory_xact_lock(hashtextextended(p_guest||':'||p_mode,612));
 select * into m from public.icash_memberships where id=p_membership for update;
 if not found or m.stripe_session_id is distinct from p_receipt->>'id'
 or not exists(select 1 from public.icash_ordinary_checkout_recovery(p_guest,p_user,p_mode,em) candidate where candidate.id=m.id)
 then raise exception 'Checkout release unavailable';end if;
 insert into public.icash_checkout_releases(membership_id,stripe_session_id,receipt,verified_user_id)
 values(m.id,m.stripe_session_id,p_receipt,p_user);
 update public.icash_memberships set state='cancelled',updated_at=now() where id=m.id;
end $$;
revoke all on function public.icash_ordinary_checkout_recovery(text,uuid,text,text),public.icash_release_ordinary_checkout(text,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_ordinary_checkout_recovery(text,uuid,text,text),public.icash_release_ordinary_checkout(text,uuid,text,text,uuid,jsonb) to service_role;

-- Email verification is allowed for a real pending ordinary checkout, too.
-- It does not grant software access or claim an unpaid membership.
do $$ declare definition text;anchor text:='and trial.legacy_trial_offer=''legacy-trial-2026-10-25.1''';begin
 select pg_get_functiondef('public.icash_can_sign_in(text,text)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 then raise exception 'Sign-in definition changed; review checkout recovery';end if;
 execute replace(definition,anchor,'and (trial.legacy_trial_offer=''legacy-trial-2026-10-25.1'' or (trial.legacy_trial_offer is null and trial.paid_through is null and not exists(select 1 from public.icash_membership_invoices i where i.membership_id=trial.id)))');
end $$;

-- Add checkout context to the private audit without exposing customer/account
-- existence to a visitor who only supplied an email. Preserve all claim guards.
do $$ declare definition text;
 anchor text:='''emailCodeDelivery'',''unverified'')';
 replacement text:=$replacement$'emailCodeDelivery','unverified','checkouts',coalesce((select jsonb_agg(found.item) from (
  select jsonb_build_object('state',member.state,'offer',case when member.legacy_trial_offer is null then 'standard' else 'returning' end,
   'hasCheckout',member.stripe_session_id is not null,'hasSubscription',member.stripe_subscription_id is not null,
   'accountLinked',member.account_id is not null,'trialStarted',member.legacy_trial_started_at is not null,
   'hasPaidReceipt',exists(select 1 from public.icash_membership_invoices i where i.membership_id=member.id),
   'recordedAt',member.updated_at) item
  from public.icash_memberships member where member.mode='live'
   and (member.checkout_email=lower(trim(r.email)) or lower(trim(member.payer_email))=lower(trim(r.email)))
  order by member.updated_at desc,member.id desc limit 5) found),'[]'::jsonb))$replacement$;
begin
 select pg_get_functiondef('public.icash_access_help_investigate(uuid,uuid,uuid,boolean,boolean,text)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 then raise exception 'Support investigation definition changed; review checkout diagnostics';end if;
 execute replace(definition,anchor,replacement);
end $$;
commit;
