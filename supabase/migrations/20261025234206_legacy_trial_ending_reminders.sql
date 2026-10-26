begin;
create table public.icash_legacy_trial_reminders (
 id uuid primary key default gen_random_uuid(),
 membership_id uuid not null references public.icash_memberships(id),
 stripe_subscription_id text not null,
 trial_end timestamptz not null,
 recipient text not null,
 message jsonb not null check(jsonb_typeof(message)='object' and pg_column_size(message)<12000),
 state text not null default 'pending' check(state in ('pending','sending','sent','held','stopped')),
 first_attempt_at timestamptz,
 claim_token uuid,
 lease_until timestamptz,
 provider_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(stripe_subscription_id,trial_end)
);
alter table public.icash_legacy_trial_reminders enable row level security;
revoke all on public.icash_legacy_trial_reminders from public,anon,authenticated;
grant select,insert,update on public.icash_legacy_trial_reminders to service_role;

create function public.icash_claim_legacy_trial_reminder(p_membership uuid,p_subscription text,p_trial_end timestamptz,p_message jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;r public.icash_legacy_trial_reminders;token uuid:=gen_random_uuid();
begin
 select * into m from public.icash_memberships where id=p_membership for share;
 if not found or m.mode<>'live' or m.legacy_trial_offer is distinct from 'legacy-trial-2026-10-25.1'
 or m.stripe_subscription_id is distinct from p_subscription or m.legacy_trial_end is distinct from p_trial_end
 or p_trial_end is null or m.checkout_email is null or m.payer_email is distinct from m.checkout_email
 then raise exception 'Trial reminder membership mismatch';end if;
 if m.state<>'active' or m.legacy_trial_started_at is null or m.cancel_at_period_end or m.price_cents<>5000
 or m.paid_through is null or m.paid_through<p_trial_end or p_trial_end<=now() or p_trial_end>now()+interval '4 days'
 then return null;end if;
 if exists(select 1 from public.icash_email_suppressions where email=m.checkout_email)
 or exists(select 1 from public.icash_webinar_suppressions where email=m.checkout_email and reason ~* '(bounc|complain|suppress)')
 or exists(select 1 from public.icash_purchase_access_emails where recipient=m.checkout_email and delivery in ('bounced','complained','suppressed'))
 then return null;end if;
 if p_message is null or jsonb_typeof(p_message)<>'object' or pg_column_size(p_message)>=12000
 or p_message->'to' is distinct from jsonb_build_array(m.checkout_email)
 or p_message->>'from' is distinct from 'iCash X <signin@geticashx.com>'
 or p_message->>'reply_to' is distinct from 'support@geticashx.com'
 or p_message ? 'cc' or p_message ? 'bcc' then raise exception 'Invalid trial reminder message';end if;
 insert into public.icash_legacy_trial_reminders(membership_id,stripe_subscription_id,trial_end,recipient,message)
 values(m.id,p_subscription,p_trial_end,m.checkout_email,p_message) on conflict(stripe_subscription_id,trial_end) do nothing;
 select * into strict r from public.icash_legacy_trial_reminders where stripe_subscription_id=p_subscription and trial_end=p_trial_end for update;
 if r.membership_id<>m.id or r.recipient<>m.checkout_email or r.message<>p_message then raise exception 'Reminder message is immutable';end if;
 if r.state in ('sent','held','stopped') then return null;end if;
 -- Resend idempotency lasts 24 hours. Stop an uncertain receipt safely before
 -- that boundary instead of risking a duplicate under a new provider window.
 if r.first_attempt_at is not null and r.first_attempt_at<now()-interval '23 hours' then
  update public.icash_legacy_trial_reminders set state='held',claim_token=null,lease_until=null,updated_at=now() where id=r.id;
  return null;
 end if;
 if r.state='sending' and r.lease_until>now() then raise exception 'Reminder delivery lease active';end if;
 update public.icash_legacy_trial_reminders set state='sending',first_attempt_at=coalesce(first_attempt_at,now()),claim_token=token,lease_until=now()+interval '2 minutes',updated_at=now() where id=r.id;
 return jsonb_build_object('id',r.id,'token',token,'message',r.message);
end $$;

create function public.icash_finish_legacy_trial_reminder(p_id uuid,p_token uuid,p_provider uuid,p_retry boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.icash_legacy_trial_reminders;
begin
 select * into r from public.icash_legacy_trial_reminders where id=p_id for update;
 if not found then raise exception 'Unknown trial reminder';end if;
 if r.state='sent' and r.provider_id=p_provider then return;end if;
 if r.state<>'sending' or r.claim_token is distinct from p_token then raise exception 'Trial reminder lease changed';end if;
 update public.icash_legacy_trial_reminders set state=case when p_provider is not null then 'sent' when p_retry and first_attempt_at>now()-interval '23 hours' then 'pending' else 'held' end,
 provider_id=p_provider,claim_token=null,lease_until=null,updated_at=now() where id=p_id;
end $$;
revoke all on function public.icash_claim_legacy_trial_reminder(uuid,text,timestamptz,jsonb),public.icash_finish_legacy_trial_reminder(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.icash_claim_legacy_trial_reminder(uuid,text,timestamptz,jsonb),public.icash_finish_legacy_trial_reminder(uuid,uuid,uuid,boolean) to service_role;
commit;
