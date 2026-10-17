begin;

-- A purchase confirmation is transactional. It never enrolls a marketing contact.
create table public.icash_purchase_access_emails (
 id uuid primary key default gen_random_uuid(),
 membership_id uuid not null unique references public.icash_memberships(id),
 invoice_id text not null unique references public.icash_membership_invoices(stripe_invoice_id),
 recipient text not null check(length(recipient)<=254 and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','canceled','needs_review')),
 attempts integer not null default 0 check(attempts between 0 and 6),
 claim_token uuid, claimed_at timestamptz, first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(),
 message jsonb, provider_id text unique, delivery text, delivery_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index icash_purchase_email_due on public.icash_purchase_access_emails(next_attempt_at,created_at) where status in ('pending','sending');
create index icash_purchase_email_recipient on public.icash_purchase_access_emails(recipient) where delivery in ('bounced','complained','suppressed');
alter table public.icash_purchase_access_emails enable row level security;
revoke all on public.icash_purchase_access_emails from public,anon,authenticated;
grant select,insert,update on public.icash_purchase_access_emails to service_role;

create function public.icash_queue_purchase_access_email() returns trigger language plpgsql security invoker set search_path='' as $$
declare invoice text;
begin
 -- First settled paid period only: no renewals, free invitations, tests or backfill.
 if old.paid_through is not null or new.paid_through is null or new.paid_through<=now() or new.mode<>'live'
 or new.payer_email is null or length(new.payer_email)>254 or new.payer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return new;end if;
 select i.stripe_invoice_id into invoice from public.icash_membership_invoices i
 where i.membership_id=new.id and i.amount_cents>0 order by i.recorded_at,i.stripe_invoice_id limit 1;
 if invoice is not null then
  insert into public.icash_purchase_access_emails(membership_id,invoice_id,recipient)
  values(new.id,invoice,lower(trim(new.payer_email))) on conflict(membership_id) do nothing;
 end if;
 return new;
end $$;
create trigger icash_purchase_access_email after update of paid_through on public.icash_memberships
for each row execute function public.icash_queue_purchase_access_email();

create function public.icash_purchase_email_allowed(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_purchase_access_emails e
 join public.icash_memberships m on m.id=e.membership_id
 join public.icash_membership_invoices i on i.stripe_invoice_id=e.invoice_id and i.membership_id=m.id
 where e.id=p_id and m.mode='live' and m.state='active' and m.paid_through>now()
 and lower(trim(m.payer_email))=e.recipient and i.amount_cents>0
 and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=i.stripe_payment_id and r.resolved_at is null)
 and not exists(select 1 from public.icash_email_suppressions s where s.email=e.recipient)
 and not exists(select 1 from public.icash_webinar_suppressions s where s.email=e.recipient and s.reason ~* '(bounc|complain|suppress)')
 and not exists(select 1 from public.icash_purchase_access_emails s where s.recipient=e.recipient and s.delivery in ('bounced','complained','suppressed')));
$$;

create function public.icash_claim_purchase_access_email(p_membership uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_purchase_access_emails; vip boolean;
begin
 select * into e from public.icash_purchase_access_emails
 where (p_membership is null or membership_id=p_membership) and next_attempt_at<=now()
 and (status='pending' or (status='sending' and claimed_at<now()-interval '2 minutes'))
 order by next_attempt_at,created_at for update skip locked limit 1;
 if not found then return null;end if;
 -- Leave a full hour inside the provider's 24-hour idempotency window.
 if e.attempts>=6 or e.first_attempt_at<=now()-interval '23 hours' or e.created_at<now()-interval '3 days' then
  update public.icash_purchase_access_emails set status='needs_review',updated_at=now() where id=e.id;return null;
 end if;
 if not public.icash_purchase_email_allowed(e.id) then
  -- Stripe state synchronization may finish immediately after invoice settlement.
  if exists(select 1 from public.icash_memberships where id=e.membership_id and state='pending' and mode='live') then
   update public.icash_purchase_access_emails set next_attempt_at=now()+interval '1 minute',updated_at=now() where id=e.id;return null;
  end if;
  update public.icash_purchase_access_emails set status='canceled',updated_at=now() where id=e.id;return null;
 end if;
 select exists(select 1 from public.icash_memberships m join public.icash_webinars w on w.id=m.post_purchase_webinar_id
 where m.id=e.membership_id and w.parent_webinar_id is not null and w.config->>'status'='published'
 and (nullif(w.config->>'videoUrl','') is not null or nullif(w.config#>>'{nightVersion,videoUrl}','') is not null)) into vip;
 update public.icash_purchase_access_emails set status='sending',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()
 where id=e.id returning * into e;
 return jsonb_build_object('id',e.id,'claimToken',e.claim_token,'membershipId',e.membership_id,'recipient',e.recipient,'vip',vip,'message',e.message);
end $$;

create function public.icash_authorize_purchase_access_email(p_id uuid,p_claim uuid,p_message jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_purchase_access_emails;
begin
 select * into e from public.icash_purchase_access_emails where id=p_id for update;
 if not found or e.status<>'sending' or e.claim_token is distinct from p_claim or e.claimed_at<now()-interval '90 seconds' then return null;end if;
 if not public.icash_purchase_email_allowed(e.id) or e.first_attempt_at<=now()-interval '23 hours' then
  update public.icash_purchase_access_emails set status='canceled',updated_at=now() where id=e.id;return null;
 end if;
 if e.message is null then
  if jsonb_typeof(p_message) is distinct from 'object' or p_message->'to' is distinct from jsonb_build_array(e.recipient)
  or length(p_message::text)>20000 then raise exception 'Invalid purchase email';end if;
  update public.icash_purchase_access_emails set message=p_message where id=e.id;
 end if;
 -- Frozen bytes and one stable key survive provider or database timeouts.
 update public.icash_purchase_access_emails set first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=e.id returning * into e;
 return e.message;
end $$;

create function public.icash_finish_purchase_access_email(p_id uuid,p_claim uuid,p_provider text,p_retry boolean default false) returns void language plpgsql security invoker set search_path='' as $$
declare e public.icash_purchase_access_emails;
begin
 select * into e from public.icash_purchase_access_emails where id=p_id for update;
 if not found or e.status<>'sending' or e.claim_token is distinct from p_claim then return;end if;
 if p_provider is not null then
  if p_provider !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid receipt';end if;
  update public.icash_purchase_access_emails set status='sent',provider_id=p_provider,updated_at=now() where id=e.id;
 else
  update public.icash_purchase_access_emails set status=case when p_retry and e.attempts<6 and (e.first_attempt_at is null or e.first_attempt_at>now()-interval '23 hours') then 'pending' when p_retry then 'needs_review' else 'failed' end,
   next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,e.attempts-1)::integer)),updated_at=now() where id=e.id;
 end if;
end $$;

create function public.icash_purchase_access_email_delivery(p_id uuid,p_provider text,p_recipient text,p_kind text) returns void language plpgsql security invoker set search_path='' as $$
declare e public.icash_purchase_access_emails;
begin
 if p_kind not in ('delivered','bounced','complained','delivery_delayed','failed','suppressed') or p_provider is null then return;end if;
 select * into e from public.icash_purchase_access_emails
 where recipient=lower(trim(p_recipient)) and (provider_id=p_provider or (id=p_id and provider_id is null and first_attempt_at is not null)) for update;
 if not found then return;end if;
 update public.icash_purchase_access_emails set provider_id=p_provider,
 status=case when p_kind in ('failed','suppressed') then 'failed' else 'sent' end,
 delivery=case when delivery in ('bounced','complained','failed','suppressed') then delivery else p_kind end,
 delivery_at=now(),updated_at=now() where id=e.id;
end $$;

revoke all on function public.icash_queue_purchase_access_email(),public.icash_purchase_email_allowed(uuid),public.icash_claim_purchase_access_email(uuid),public.icash_authorize_purchase_access_email(uuid,uuid,jsonb),public.icash_finish_purchase_access_email(uuid,uuid,text,boolean),public.icash_purchase_access_email_delivery(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_queue_purchase_access_email(),public.icash_purchase_email_allowed(uuid),public.icash_claim_purchase_access_email(uuid),public.icash_authorize_purchase_access_email(uuid,uuid,jsonb),public.icash_finish_purchase_access_email(uuid,uuid,text,boolean),public.icash_purchase_access_email_delivery(uuid,text,text,text) to service_role;
commit;
