begin;
set local lock_timeout='3s';
-- Preserve the existing RPC identity, privileges, RLS and immutable receipts.
create or replace function public.icash_claim_legacy_trial_reminder(p_membership uuid,p_subscription text,p_trial_end timestamptz,p_message jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;r public.icash_legacy_trial_reminders;token uuid:=gen_random_uuid();
begin
 select * into m from public.icash_memberships where id=p_membership for share;
 if not found or m.mode<>'live' or m.legacy_trial_offer is distinct from 'legacy-trial-2026-10-25.1'
 or m.stripe_subscription_id is distinct from p_subscription or m.legacy_trial_end is distinct from p_trial_end
 or p_trial_end is null or m.checkout_email is null or m.payer_email is distinct from m.checkout_email
 then raise exception 'Trial reminder membership mismatch';end if;
 if m.state<>'active' or m.legacy_trial_started_at is null or m.cancel_at_period_end or m.price_cents not in (5000,10000)
 or m.paid_through is null or m.paid_through<p_trial_end or p_trial_end<=now() or p_trial_end>now()+interval '4 days'
 then return null;end if;
 -- The $100 introductory-period renewal must follow an actually paid VIP upgrade.
 if m.price_cents=10000 and (m.vip_until is null or m.vip_until<p_trial_end or not exists(
  select 1 from public.icash_plan_changes c where c.membership_id=m.id and c.action='upgrade'
  and c.state='applied' and c.payment_id is not null and c.from_price=5000 and c.to_price=10000
  and c.period_end=p_trial_end)) then raise exception 'Paid trial VIP upgrade required';end if;
 if exists(select 1 from public.icash_email_suppressions where email=m.checkout_email)
 or exists(select 1 from public.icash_webinar_suppressions where email=m.checkout_email and reason ~* '(bounc|complain|suppress)')
 or exists(select 1 from public.icash_purchase_access_emails where recipient=m.checkout_email and delivery in ('bounced','complained','suppressed'))
 then return null;end if;
 if p_message is null or jsonb_typeof(p_message)<>'object' or pg_column_size(p_message)>=12000
 or p_message->'to' is distinct from jsonb_build_array(m.checkout_email)
 or p_message->>'from' is distinct from 'iCash X <signin@geticashx.com>'
 or p_message->>'reply_to' is distinct from 'support@geticashx.com'
 or p_message ? 'cc' or p_message ? 'bcc' then raise exception 'Invalid trial reminder message';end if;
 -- Bind the quoted renewal amount to the locked membership, not an earlier read.
 if coalesce(strpos(p_message->>'text',format('renew at $%s USD per month',m.price_cents/100)),0)=0
 or coalesce(strpos(p_message->>'text',format('first $%s charge',m.price_cents/100)),0)=0
 then raise exception 'Trial reminder renewal amount changed';end if;
 insert into public.icash_legacy_trial_reminders(membership_id,stripe_subscription_id,trial_end,recipient,message)
 values(m.id,p_subscription,p_trial_end,m.checkout_email,p_message) on conflict(stripe_subscription_id,trial_end) do nothing;
 select * into strict r from public.icash_legacy_trial_reminders where stripe_subscription_id=p_subscription and trial_end=p_trial_end for update;
 if r.membership_id<>m.id or r.recipient<>m.checkout_email then raise exception 'Reminder message is immutable';end if;
 -- A price change after the original send/uncertain attempt must never rewrite
 -- that receipt or resend its stale quote. The upgrade has its own acceptance.
 if r.message<>p_message and r.message=jsonb_set(p_message,'{text}',to_jsonb(
  replace(replace(p_message->>'text',format('$%s USD per month',m.price_cents/100),
  format('$%s USD per month',case when m.price_cents=5000 then 100 else 50 end)),
  format('first $%s charge',m.price_cents/100),format('first $%s charge',case when m.price_cents=5000 then 100 else 50 end))))
 then return null;end if;
 if r.message<>p_message then raise exception 'Reminder message is immutable';end if;
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

commit;
