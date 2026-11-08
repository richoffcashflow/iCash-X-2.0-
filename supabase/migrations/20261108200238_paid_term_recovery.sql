begin;
-- Installation grants nobody access. Each recovery requires a separate reviewed
-- operator action bound to the original paid membership and its remaining term.
create table public.icash_paid_term_recoveries(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 owner_user_id uuid not null,
 source_membership_id uuid not null unique references public.icash_memberships(id),
 membership_id uuid not null unique references public.icash_memberships(id) deferrable initially deferred,
 invoice_id text not null references public.icash_membership_invoices(stripe_invoice_id),
 upgrade_id uuid not null references public.icash_plan_changes(id),
 support_case_id uuid not null references public.icash_support_threads(id),
 ends_at timestamptz not null,
 authorization_reference text not null check(length(authorization_reference) between 20 and 2000),
 source_evidence jsonb not null,
 created_at timestamptz not null default now(),
 check(source_membership_id<>membership_id and ends_at>created_at)
);
alter table public.icash_paid_term_recoveries enable row level security;
revoke all on public.icash_paid_term_recoveries from public,anon,authenticated;
grant select,insert on public.icash_paid_term_recoveries to service_role;

create function public.icash_paid_term_recovery_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Paid-term recovery audit is immutable';end $$;
create trigger icash_paid_term_recovery_immutable before update or delete on public.icash_paid_term_recoveries
 for each row execute function public.icash_paid_term_recovery_immutable();

create function public.icash_paid_term_recovery_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.icash_paid_term_recoveries;s public.icash_memberships;
begin
 if tg_op='UPDATE' and old.consent_version='paid-term-recovery-v1' then
  if (to_jsonb(new)-array['state','updated_at']) is distinct from (to_jsonb(old)-array['state','updated_at'])
   or new.state not in ('active','cancel_requested','cancelled','needs_review')
   or (old.state<>'active' and new.state='active') then raise exception 'Recovery boundary is immutable';end if;
  return new;
 end if;
 if new.consent_version<>'paid-term-recovery-v1' then return new;end if;
 if tg_op<>'INSERT' then raise exception 'Existing purchase cannot become a recovery';end if;
 select * into r from public.icash_paid_term_recoveries where membership_id=new.id;
 select * into s from public.icash_memberships where id=r.source_membership_id;
 if r.id is null or s.id is null or s.account_id is distinct from r.account_id or s.state<>'cancelled'
  or s.paid_through is distinct from r.ends_at or s.vip_until is distinct from r.ends_at
  or new.account_id is distinct from r.account_id
  or new.mode<>'live' or new.state<>'active' or new.guest_hash is distinct from s.guest_hash
  or new.post_purchase_webinar_id is distinct from s.post_purchase_webinar_id
  or new.paid_through is distinct from r.ends_at or new.vip_until is distinct from r.ends_at
  or new.price_cents<>10000 or new.cancel_at_period_end is not true
  or new.stripe_session_id is not null or new.stripe_subscription_id is not null
  or new.stripe_customer_id is not null or new.checkout_url is not null
  or new.private_invite_id is not null or new.legacy_trial_offer is not null
  or new.vip_retained_at is not null or new.retention_requested_at is not null
  or new.payer_email is not null or new.payer_phone is not null or new.checkout_email is not null
  then raise exception 'Recovery entitlement does not match its audit';end if;
 return new;
end $$;
create trigger icash_paid_term_recovery_guard before insert or update on public.icash_memberships
 for each row execute function public.icash_paid_term_recovery_guard();

create function public.icash_restore_paid_term(p_account uuid,p_source uuid,p_invoice text,p_upgrade uuid,p_case uuid,p_end timestamptz,p_authorization text)
returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare s public.icash_memberships;m public.icash_memberships;a public.icash_accounts;
 i public.icash_membership_invoices;v public.icash_plan_changes;r public.icash_paid_term_recoveries;new_id uuid:=gen_random_uuid();
begin
 if p_account is null or p_source is null or p_invoice is null or p_upgrade is null or p_case is null
  or p_end is null or p_authorization is null or length(p_authorization) not between 20 and 2000
  then raise exception 'Explicit reviewed recovery required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into s from public.icash_memberships where id=p_source for update;
 select * into a from public.icash_accounts where id=p_account for update;
 if a.id is null or s.id is null or s.account_id is distinct from a.id or s.mode<>'live'
  or s.state<>'cancelled' or s.stripe_subscription_id is null or s.stripe_customer_id is null
  or s.paid_through is distinct from p_end or s.vip_until is distinct from p_end
  or s.price_cents<>10000 or s.private_invite_id is not null or s.legacy_trial_offer is not null
  then raise exception 'Original paid VIP term mismatch';end if;
 select * into r from public.icash_paid_term_recoveries where source_membership_id=s.id;
 if found then
  if r.account_id<>a.id or r.owner_user_id is distinct from a.owner_user_id or r.invoice_id<>p_invoice
   or r.upgrade_id<>p_upgrade or r.support_case_id<>p_case or r.ends_at<>p_end
   or r.authorization_reference<>p_authorization then raise exception 'Recovery replay mismatch';end if;
  select * into m from public.icash_memberships where id=r.membership_id;
  return m; -- Never extend, reactivate or unpause on retry.
 end if;
 if not exists(select 1 from public.icash_support_threads where id=p_case and account_id=a.id) then raise exception 'Account-bound support case required';end if;
 if a.bot_paused is not true or a.owner_user_id is null or p_end<=now() or p_end>now()+interval '32 days'
  then raise exception 'Paused account and remaining original term required';end if;
 if exists(select 1 from public.icash_memberships where account_id=a.id and mode='live' and state<>'cancelled')
  then raise exception 'Resolve current entitlement before recovery';end if;
 select * into i from public.icash_membership_invoices where stripe_invoice_id=p_invoice;
 select * into v from public.icash_plan_changes where id=p_upgrade;
 if i.membership_id is distinct from s.id or i.amount_cents is distinct from 5000 or i.period_end is distinct from p_end
  or i.stripe_payment_id is null or v.membership_id is distinct from s.id or v.account_id is distinct from a.id
  or v.action is distinct from 'upgrade' or v.state is distinct from 'applied' or v.from_price is distinct from 5000
  or v.to_price is distinct from 10000 or v.period_end is distinct from p_end or v.payment_id is null
  or exists(select 1 from public.icash_billing_reviews where payment_id in(i.stripe_payment_id,v.payment_id) and resolved_at is null)
  then raise exception 'Verified original payments required';end if;
 insert into public.icash_paid_term_recoveries(account_id,owner_user_id,source_membership_id,membership_id,invoice_id,upgrade_id,support_case_id,ends_at,authorization_reference,source_evidence)
 values(a.id,a.owner_user_id,s.id,new_id,i.stripe_invoice_id,v.id,p_case,p_end,p_authorization,
  jsonb_build_object('subscription',s.stripe_subscription_id,'customer',s.stripe_customer_id,'sourceState',s.state,
   'softwarePayment',i.stripe_payment_id,'softwareAmountCents',i.amount_cents,'vipPayment',v.payment_id,
   'vipAmountCents',v.to_price-v.from_price,'postPurchaseWebinar',s.post_purchase_webinar_id,'paidThrough',s.paid_through,'vipUntil',s.vip_until,'botPaused',a.bot_paused));
 insert into public.icash_memberships(id,mode,guest_hash,account_id,price_cents,offer_revision,state,paid_through,vip_until,post_purchase_webinar_id,cancel_at_period_end,consent_version,consent_text)
 values(new_id,'live',s.guest_hash,a.id,10000,s.offer_revision,'active',p_end,p_end,s.post_purchase_webinar_id,true,'paid-term-recovery-v1',
  'Owner-authorized restoration of the original paid software and VIP term. No new payment, renewal, customer acceptance, work credit or outreach restart.') returning * into m;
 return m;
end $$;
revoke all on function public.icash_paid_term_recovery_immutable(),public.icash_paid_term_recovery_guard(),public.icash_restore_paid_term(uuid,uuid,text,uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.icash_paid_term_recovery_immutable(),public.icash_paid_term_recovery_guard(),public.icash_restore_paid_term(uuid,uuid,text,uuid,uuid,timestamptz,text) to service_role;
-- Later original-payment refund/dispute reviews suspend the recovered access too.
create function public.icash_hold_paid_term_recovery() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 if new.resolved_at is not null then return new;end if;
 if tg_op='UPDATE' and old.payment_id is not distinct from new.payment_id and old.resolved_at is null then return new;end if;
 -- Work-credit/daily reviews and account-only backfills are unrelated.
 if not exists(select 1 from public.icash_membership_invoices where stripe_payment_id=new.payment_id)
  and not exists(select 1 from public.icash_plan_changes where payment_id=new.payment_id) then return new;end if;
 -- Serialize with cancellation's budget -> membership -> account lock order.
 perform 1 from public.icash_operating_budget where id=1 for update;
 for a in select distinct m.account_id from public.icash_memberships m where m.account_id is not null and
  (exists(select 1 from public.icash_membership_invoices i where i.membership_id=m.id and i.stripe_payment_id=new.payment_id)
   or exists(select 1 from public.icash_plan_changes v where v.membership_id=m.id and v.payment_id=new.payment_id)) order by m.account_id
 loop
  -- The creator holds this account lock before testing the original reviews.
  perform 1 from public.icash_accounts where id=a for update;
  update public.icash_memberships m set state='needs_review',updated_at=now()
  from public.icash_paid_term_recoveries r where r.account_id=a and m.id=r.membership_id and m.state='active'
   and new.payment_id in(r.source_evidence->>'softwarePayment',r.source_evidence->>'vipPayment');
  if found then update public.icash_accounts set bot_paused=true where id=a;end if;
 end loop;
 return new;
end $$;
create trigger icash_hold_paid_term_recovery after insert or update of payment_id,resolved_at on public.icash_billing_reviews
 for each row execute function public.icash_hold_paid_term_recovery();
revoke all on function public.icash_hold_paid_term_recovery() from public,anon,authenticated;
grant execute on function public.icash_hold_paid_term_recovery() to service_role;
commit;
