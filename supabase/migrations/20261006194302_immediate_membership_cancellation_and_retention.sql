begin;
-- Cancellation intent is durable before provider calls; installing this changes no subscriptions.
alter table public.icash_memberships drop constraint icash_memberships_state_check;
alter table public.icash_memberships add constraint icash_memberships_state_check
 check(state in ('pending','active','payment_failed','cancel_requested','cancelled','needs_review'));
create index icash_membership_cancellation_retry on public.icash_memberships(mode,updated_at)
 where state='cancel_requested';

create function public.icash_preserve_membership_cancellation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- A delayed active event must never revive a stopped subscription.
 if old.state='cancelled' then new.state:='cancelled';
 elsif old.state='cancel_requested' and new.state<>'cancelled' then new.state:='cancel_requested';end if;
 return new;
end $$;
create trigger icash_preserve_membership_cancellation before update on public.icash_memberships
 for each row execute function public.icash_preserve_membership_cancellation();

create function public.icash_request_membership_cancellation(p_membership uuid,p_account uuid,p_mode text)
returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;owner_id uuid;
begin
 if p_mode is null or p_mode not in ('live','test') then raise exception 'Billing mode required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_memberships where id=p_membership for update;
 if m.id is null or m.account_id is distinct from p_account or m.mode<>p_mode then raise exception 'Membership ownership mismatch';end if;
 -- Replaying an old cancellation must not pause a later renewed subscription.
 if m.state='cancelled' then return m;end if;
 if m.account_id is not null then
  select owner_user_id into owner_id from public.icash_accounts where id=m.account_id;
  if owner_id is null then raise exception 'Account unavailable';end if;
  perform public.icash_pause_work_and_billing(owner_id,m.account_id,m.mode);
 end if;
 update public.icash_memberships set state='cancel_requested',updated_at=now() where id=m.id returning * into m;
 -- No wallet or credit-ledger mutation: unused credits remain on the same account.
 return m;
end $$;
revoke all on function public.icash_request_membership_cancellation(uuid,uuid,text),public.icash_preserve_membership_cancellation() from public,anon,authenticated;
grant execute on function public.icash_request_membership_cancellation(uuid,uuid,text),public.icash_preserve_membership_cancellation() to service_role;

-- New checkouts record the immediate-cancellation disclosure version.
do $$declare definition text;begin
 select pg_get_functiondef('public.icash_begin_membership(text,uuid,text,bigint,integer,text)'::regprocedure) into definition;
 if position('membership-2026-10-03.1' in definition)=0 then raise exception 'Unexpected membership consent version';end if;
 execute replace(definition,'membership-2026-10-03.1','membership-2026-10-06.1');
end $$;


alter table public.icash_memberships
 add column retention_requested_at timestamptz,
 add column retention_started_at timestamptz,
 add column retention_ends_at timestamptz,
 add column retention_discount_id text;
create unique index icash_membership_retention_once on public.icash_memberships(account_id,mode)
 where retention_requested_at is not null;
alter table public.icash_memberships add constraint icash_retention_window check(
 (retention_discount_id is null and retention_started_at is null and retention_ends_at is null)
 or (retention_requested_at is not null and retention_discount_id ~ '^di_[A-Za-z0-9]+$'
 and retention_started_at is not null and retention_ends_at is not null
 and retention_ends_at>retention_started_at and retention_ends_at<=retention_started_at+interval '186 days'));

create function public.icash_claim_membership_retention(p_membership uuid,p_account uuid,p_mode text)
returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;
begin
 if p_account is null or p_mode is null or p_mode not in ('live','test') then raise exception 'Account required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||p_mode,616));
 select * into m from public.icash_memberships where id=p_membership for update;
 if m.id is null or m.account_id is distinct from p_account or m.mode<>p_mode
 or m.state<>'active' or m.cancel_at_period_end or m.paid_through is null or m.paid_through<=now()
 or m.stripe_subscription_id is null then raise exception 'Retention unavailable';end if;
 if m.retention_requested_at is not null then return m;end if;
 if exists(select 1 from public.icash_memberships where account_id=p_account and mode=p_mode and retention_requested_at is not null) then raise exception 'Offer already used';end if;
 update public.icash_memberships set retention_requested_at=now() where id=m.id returning * into m;
 return m;
end $$;
revoke all on function public.icash_claim_membership_retention(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_membership_retention(uuid,uuid,text) to service_role;

create function public.icash_settle_membership_invoice_v2(p_membership uuid,p_subscription text,p_customer text,p_invoice text,p_payment text,p_amount bigint,p_email text,p_phone text,p_period_end timestamptz,p_period_start timestamptz,p_discount text) returns void language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;i public.icash_membership_invoices;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 if p_subscription is null or p_customer is null or p_invoice is null or p_payment is null or m.id is null or p_amount is distinct from (case when p_discount is null then m.price_cents else m.price_cents-round(m.price_cents*0.5)::bigint end) or p_subscription !~ '^sub_[A-Za-z0-9]+$' or p_customer !~ '^cus_[A-Za-z0-9]+$' or p_invoice !~ '^in_[A-Za-z0-9]+$' or p_payment !~ '^pi_[A-Za-z0-9]+$' or p_period_end is null or p_email is null or position('@' in p_email)<2 or length(p_email)>320
 or (m.stripe_subscription_id is not null and m.stripe_subscription_id<>p_subscription) or (m.stripe_customer_id is not null and m.stripe_customer_id<>p_customer) then raise exception 'Membership invoice mismatch';end if;
 if p_period_start is null or p_period_end<=p_period_start or p_period_end>p_period_start+interval '32 days' then raise exception 'Invalid invoice period';end if;
 if p_discount is not null and (m.retention_requested_at is null or m.retention_discount_id is distinct from p_discount or m.retention_started_at is null or m.retention_ends_at is null or p_period_start<m.retention_started_at or p_period_start>=m.retention_ends_at) then raise exception 'Unauthorized retention invoice';end if;
 select * into i from public.icash_membership_invoices where stripe_invoice_id=p_invoice;
 if found then if i.membership_id<>m.id or i.stripe_payment_id<>p_payment or i.amount_cents<>p_amount or i.period_end<>p_period_end then raise exception 'Invoice replay mismatch';end if;return;end if;
 insert into public.icash_membership_invoices(stripe_invoice_id,membership_id,stripe_payment_id,amount_cents,period_end) values(p_invoice,m.id,p_payment,p_amount,p_period_end);
 update public.icash_memberships set stripe_subscription_id=p_subscription,stripe_customer_id=p_customer,payer_email=lower(trim(p_email)),payer_phone=left(p_phone,40),paid_through=greatest(paid_through,p_period_end),updated_at=now() where id=m.id;
 if exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then
 update public.icash_memberships set state='needs_review' where id=m.id;
 update public.icash_accounts set bot_paused=true where id=m.account_id;
 end if;
 -- Software payments never post to the work-credit wallet.
end $$;
revoke all on function public.icash_settle_membership_invoice_v2(uuid,text,text,text,text,bigint,text,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.icash_settle_membership_invoice_v2(uuid,text,text,text,text,bigint,text,text,timestamptz,timestamptz,text) to service_role;
commit;
