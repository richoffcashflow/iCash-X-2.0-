begin;
-- Requesting an OTP is not authentication or an access grant. Preserve every
-- existing paid/account/verified-phone branch and the API's generic response,
-- rate limits and Auth verification. A pending trial needs its verified email
-- session to recover a checkout after losing the original browser cookie.
do $$
declare definition text;
 anchor text:='exists(select 1 from public.icash_funding_orders';
 addition text:=$branch$exists(select 1 from public.icash_memberships trial
  where trial.mode=p_mode and trial.state='pending'
  and trial.legacy_trial_offer='legacy-trial-2026-10-25.1'
  and trial.legacy_trial_started_at is null and trial.stripe_subscription_id is null
  and trial.checkout_email=lower(trim(p_email))
  and trial.stripe_session_id ~ ('^cs_'||p_mode||'_[A-Za-z0-9]+$')
  and not exists(select 1 from public.icash_billing_reviews review
   where review.account_id=trial.account_id and review.resolved_at is null)
  and not exists(select 1 from public.icash_memberships held
   where held.mode=p_mode and held.state in ('needs_review','cancel_requested')
   and (held.checkout_email=trial.checkout_email or lower(trim(held.payer_email))=trial.checkout_email))
  and not exists(select 1 from auth.users blocked
   where lower(trim(blocked.email))=trial.checkout_email
   and (blocked.deleted_at is not null or blocked.banned_until>now())))
 or $branch$;
begin
 select pg_get_functiondef('public.icash_can_sign_in(text,text)'::regprocedure) into definition;
 if position(anchor in definition)=0 or position('icash_purchase_phone_identities' in definition)=0
 or position('identity.revoked_at is null' in definition)=0
 or position('u.banned_until' in definition)=0
 or position('legacy_trial_offer' in definition)>0
 or length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 then raise exception 'Sign-in eligibility definition changed; review before installing';end if;
 execute replace(definition,anchor,addition||anchor);
end $$;
revoke all on function public.icash_can_sign_in(text,text) from public,anon,authenticated;
grant execute on function public.icash_can_sign_in(text,text) to service_role;
commit;
