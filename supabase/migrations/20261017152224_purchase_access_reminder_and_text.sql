begin;
-- Additional access instructions are finite: one reminder email and one text.
-- The original confirmation remains independent, including during deployment.
create table public.icash_purchase_access_followups(
 id uuid primary key default gen_random_uuid(),
 purchase_email_id uuid not null references public.icash_purchase_access_emails(id),
 membership_id uuid not null references public.icash_memberships(id),
 channel text not null check(channel in ('email','sms')),
 recipient text not null check(length(recipient)<=254),
 visitor_id uuid references public.icash_webinar_visitors(id),
 status text not null default 'pending' check(status in ('pending','claimed','sending','sent','failed','canceled','needs_review')),
 attempts integer not null default 0 check(attempts between 0 and 6),
 due_at timestamptz not null,next_attempt_at timestamptz not null,
 claim_token uuid,claimed_at timestamptz,first_attempt_at timestamptz,
 message jsonb,provider_id text,delivery text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(membership_id,channel),unique(channel,provider_id),
 check(channel='email' and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or channel='sms' and visitor_id is not null and recipient ~ '^\+[1-9][0-9]{7,14}$')
);
create index icash_purchase_access_followups_due on public.icash_purchase_access_followups(next_attempt_at) where status in ('pending','claimed','sending');
alter table public.icash_purchase_access_followups enable row level security;
revoke all on public.icash_purchase_access_followups from public,anon,authenticated;
grant select,insert,update on public.icash_purchase_access_followups to service_role;

create function public.icash_purchase_text_contact(p_membership uuid,p_visitor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_memberships m join public.icash_webinar_visitors v on v.id=p_visitor
 where m.id=p_membership and v.phone ~ '^\+[1-9][0-9]{7,14}$'
 and (v.funding_guest_hash=m.guest_hash or v.account_id=m.account_id)
 and (v.email is null or lower(trim(v.email))=lower(trim(m.payer_email)))
 and (m.payer_phone is null or m.payer_phone=v.phone)
 and v.sms_consent_at is not null and v.sms_opted_out_at is null
 and v.sms_consent_version in ('webinar-sms-campaign-2026-10-08','webinar-sms-ongoing-2026-10-09','webinar-sms-bounded-2026-10-17','webinar-sms-recovery-2026-10-17')
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=v.phone)
 and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=v.phone));
$$;

create function public.icash_queue_purchase_access_followups() returns trigger language plpgsql security invoker set search_path='' as $$
declare contact public.icash_webinar_visitors;
begin
 if tg_op='INSERT' then
  insert into public.icash_purchase_access_followups(purchase_email_id,membership_id,channel,recipient,due_at,next_attempt_at)
  values(new.id,new.membership_id,'email',new.recipient,now()+interval '15 minutes',now()+interval '15 minutes') on conflict do nothing;
  select v.* into contact from public.icash_webinar_visitors v join public.icash_memberships m on m.id=new.membership_id
  where (v.funding_guest_hash=m.guest_hash or v.account_id=m.account_id)
  and public.icash_purchase_text_contact(new.membership_id,v.id) order by v.sms_consent_at desc,v.id limit 1;
  if found then
   insert into public.icash_purchase_access_followups(purchase_email_id,membership_id,channel,recipient,visitor_id,due_at,next_attempt_at)
   values(new.id,new.membership_id,'sms',contact.phone,contact.id,now(),now()) on conflict do nothing;
  end if;
 elsif old.provider_id is null and new.provider_id is not null then
  -- A delayed first email must not be followed immediately by the second.
  update public.icash_purchase_access_followups set due_at=greatest(due_at,now()+interval '15 minutes'),
   next_attempt_at=greatest(next_attempt_at,now()+interval '15 minutes')
  where purchase_email_id=new.id and channel='email' and first_attempt_at is null and status='pending';
 end if;
 return new;
end $$;
create trigger icash_purchase_access_followups after insert or update of provider_id on public.icash_purchase_access_emails
for each row execute function public.icash_queue_purchase_access_followups();

create function public.icash_purchase_access_followup_allowed(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_purchase_access_followups f
 join public.icash_purchase_access_emails e on e.id=f.purchase_email_id and e.membership_id=f.membership_id
 join public.icash_memberships m on m.id=f.membership_id
 join public.icash_membership_invoices i on i.stripe_invoice_id=e.invoice_id and i.membership_id=m.id
 where f.id=p_id and m.mode='live' and m.state='active' and m.paid_through>now() and i.amount_cents>0
 and lower(trim(m.payer_email))=e.recipient
 and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=i.stripe_payment_id and r.resolved_at is null)
 and case when f.channel='email' then m.account_id is null and f.recipient=e.recipient
 and e.status='sent' and e.provider_id is not null and public.icash_purchase_email_allowed(e.id)
 else public.icash_purchase_text_contact(m.id,f.visitor_id)
 and exists(select 1 from public.icash_webinar_visitors v where v.id=f.visitor_id and v.phone=f.recipient)
 and exists(select 1 from public.icash_messaging_settings where id=1 and config->>'smsEnabled'='true') end);
$$;

create function public.icash_claim_purchase_access_followup(p_channel text,p_membership uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.icash_purchase_access_followups; sender_phone text; vip boolean;
begin
 if p_channel not in ('email','sms') then raise exception 'Invalid channel';end if;
 for f in select * from public.icash_purchase_access_followups
 where channel=p_channel and (p_membership is null or membership_id=p_membership) and next_attempt_at<=now() and due_at<=now()
 and (status='pending' or status in ('claimed','sending') and claimed_at<now()-interval '2 minutes')
 order by next_attempt_at,created_at for update skip locked limit 10 loop
  if f.attempts>=6 or f.created_at<now()-interval '3 days' or f.first_attempt_at<=now()-interval '23 hours'
  or f.channel='sms' and f.first_attempt_at is not null then
   update public.icash_purchase_access_followups set status='needs_review',updated_at=now() where id=f.id;continue;
  end if;
  if exists(select 1 from public.icash_memberships where id=f.membership_id and state='pending' and mode='live')
  or f.channel='email' and exists(select 1 from public.icash_purchase_access_emails where id=f.purchase_email_id and status in ('pending','sending')) then
   update public.icash_purchase_access_followups set status='pending',next_attempt_at=now()+interval '1 minute' where id=f.id;continue;
  end if;
  if not public.icash_purchase_access_followup_allowed(f.id) then
   update public.icash_purchase_access_followups set status='canceled',updated_at=now() where id=f.id;continue;
  end if;
  if f.channel='sms' then
   sender_phone:=public.icash_webinar_campaign_sender(f.recipient);
   if sender_phone is null then update public.icash_purchase_access_followups set status='pending',next_attempt_at=now()+interval '1 minute' where id=f.id;continue;end if;
  end if;
  select exists(select 1 from public.icash_memberships m join public.icash_webinars w on w.id=m.post_purchase_webinar_id
   where m.id=f.membership_id and w.parent_webinar_id is not null and w.config->>'status'='published'
   and (nullif(w.config->>'videoUrl','') is not null or nullif(w.config#>>'{nightVersion,videoUrl}','') is not null)) into vip;
  update public.icash_purchase_access_followups set status='claimed',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()
   where id=f.id returning * into f;
  return jsonb_build_object('id',f.id,'claimToken',f.claim_token,'membershipId',f.membership_id,'recipient',f.recipient,'channel',f.channel,'sender',sender_phone,'vip',vip,'message',f.message);
 end loop;
 return null;
end $$;

create function public.icash_authorize_purchase_access_followup(p_id uuid,p_claim uuid,p_message jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.icash_purchase_access_followups; candidate jsonb; sender_phone text;
begin
 select * into f from public.icash_purchase_access_followups where id=p_id for update;
 if not found or f.status<>'claimed' or f.claim_token is distinct from p_claim or f.claimed_at<now()-interval '90 seconds' then return null;end if;
 if not public.icash_purchase_access_followup_allowed(f.id) or f.due_at>now() or f.first_attempt_at<=now()-interval '23 hours'
 or f.channel='sms' and f.first_attempt_at is not null then
  update public.icash_purchase_access_followups set status='canceled',updated_at=now() where id=f.id;return null;
 end if;
 candidate:=coalesce(f.message,p_message);
 if jsonb_typeof(candidate) is distinct from 'object' or octet_length(candidate::text)>20000 then raise exception 'Invalid access message';end if;
 if f.channel='email' then
  if candidate->'to' is distinct from jsonb_build_array(f.recipient) then raise exception 'Invalid recipient';end if;
 else
  sender_phone:=public.icash_webinar_campaign_sender(f.recipient);
  if sender_phone is null then update public.icash_purchase_access_followups set status='pending',next_attempt_at=now()+interval '1 minute',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
  if candidate->>'to' is distinct from f.recipient or candidate->>'from' is distinct from sender_phone
   or length(candidate->>'message') not between 1 and 1000 then raise exception 'Invalid text';end if;
 end if;
 update public.icash_purchase_access_followups set message=candidate,status='sending',first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=f.id;
 return candidate;
end $$;

create function public.icash_finish_purchase_access_followup(p_id uuid,p_claim uuid,p_provider text,p_outcome text default 'sent') returns void language plpgsql security invoker set search_path='' as $$
declare f public.icash_purchase_access_followups; receipt text;
begin
 select * into f from public.icash_purchase_access_followups where id=p_id;
 if not found then return;end if;
 -- Receipt webhooks and finish take the same lock before touching the job.
 if p_provider is not null then perform pg_advisory_xact_lock(hashtextextended(f.channel||':'||p_provider,816));end if;
 select * into f from public.icash_purchase_access_followups where id=p_id for update;
 if f.status<>'sending' or f.claim_token is distinct from p_claim then return;end if;
 if p_provider is not null then
  if length(p_provider) not between 1 and 200 then raise exception 'Invalid receipt';end if;
  select kind into receipt from public.icash_webinar_delivery_receipts where channel=f.channel and provider_id=p_provider;
  update public.icash_purchase_access_followups set provider_id=p_provider,status='sent',delivery=receipt,updated_at=now() where id=f.id;
  if receipt in ('bounced','complained','suppressed') and f.channel='email' then
   insert into public.icash_webinar_suppressions(email,reason) values(f.recipient,'purchase_access_'||receipt)
   on conflict(email) do update set reason=excluded.reason;
  end if;
 else
  update public.icash_purchase_access_followups set status=case
   when p_outcome='retry' and f.channel='email' and f.attempts<6 and f.first_attempt_at>now()-interval '23 hours' then 'pending'
   when p_outcome in ('retry','unknown') then 'needs_review' else 'failed' end,
   next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,f.attempts-1)::integer)),updated_at=now() where id=f.id;
 end if;
end $$;

create function public.icash_purchase_access_followup_delivery() returns trigger language plpgsql security invoker set search_path='' as $$
declare f public.icash_purchase_access_followups;
begin
 for f in select * from public.icash_purchase_access_followups where channel=new.channel and provider_id=new.provider_id for update loop
  update public.icash_purchase_access_followups set delivery=case when delivery in ('bounced','complained','suppressed','failed') then delivery else new.kind end,updated_at=now() where id=f.id;
  if new.channel='email' and new.kind in ('bounced','complained','suppressed') then
   insert into public.icash_webinar_suppressions(email,reason) values(f.recipient,'purchase_access_'||new.kind)
   on conflict(email) do update set reason=excluded.reason;
  end if;
 end loop;
 return new;
end $$;
create trigger icash_purchase_access_followup_delivery after insert or update on public.icash_webinar_delivery_receipts
for each row execute function public.icash_purchase_access_followup_delivery();

revoke all on function public.icash_purchase_text_contact(uuid,uuid),public.icash_queue_purchase_access_followups(),public.icash_purchase_access_followup_allowed(uuid),public.icash_claim_purchase_access_followup(text,uuid),public.icash_authorize_purchase_access_followup(uuid,uuid,jsonb),public.icash_finish_purchase_access_followup(uuid,uuid,text,text),public.icash_purchase_access_followup_delivery() from public,anon,authenticated;
grant execute on function public.icash_purchase_text_contact(uuid,uuid),public.icash_queue_purchase_access_followups(),public.icash_purchase_access_followup_allowed(uuid),public.icash_claim_purchase_access_followup(text,uuid),public.icash_authorize_purchase_access_followup(uuid,uuid,jsonb),public.icash_finish_purchase_access_followup(uuid,uuid,text,text),public.icash_purchase_access_followup_delivery() to service_role;
commit;
