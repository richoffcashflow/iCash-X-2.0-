-- Bind a personal invitation to its owned pending checkout; this grants no access.
create table public.icash_legacy_checkouts (
 contact_id uuid not null references public.icash_legacy_contacts(id),membership_id uuid not null references public.icash_memberships(id),
 created_at timestamptz not null default now(),primary key(contact_id,membership_id)
);
alter table public.icash_legacy_checkouts enable row level security;
revoke all on public.icash_legacy_checkouts from public,anon,authenticated;
grant select,insert on public.icash_legacy_checkouts to service_role;
create index icash_legacy_checkouts_membership on public.icash_legacy_checkouts(membership_id);
create function public.icash_legacy_checkout_bind(p_contact uuid,p_membership uuid) returns void language sql security invoker set search_path='' as $$
 insert into public.icash_legacy_checkouts(contact_id,membership_id)
 select c.id,m.id from public.icash_legacy_contacts c cross join public.icash_memberships m
 where c.id=p_contact and m.id=p_membership and m.mode='live' and m.state='pending'
 and c.converted_at is null and c.suppressed_reason is null
 and not exists(select 1 from public.icash_membership_invoices i where i.membership_id=m.id)
 on conflict do nothing;
$$;
revoke all on function public.icash_legacy_checkout_bind(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_legacy_checkout_bind(uuid,uuid) to service_role;
create or replace function public.icash_legacy_sync(p_launch uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Any receipt-backed live purchase stops this acquisition sequence permanently,
 -- including a customer who later cancels or refunds. A pending checkout never counts.
 with purchased as (
  select c.id,min(i.recorded_at) paid_at,(array_agg(m.id order by i.recorded_at))[1] membership_id
  from public.icash_legacy_contacts c join public.icash_memberships m on m.mode='live' and ((c.email is not null and c.email=lower(trim(m.payer_email))) or (c.phone is not null and c.phone=m.payer_phone) or exists(select 1 from public.icash_legacy_checkouts b where b.contact_id=c.id and b.membership_id=m.id))
  join public.icash_membership_invoices i on i.membership_id=m.id
  where c.launch_id=p_launch and c.converted_at is null group by c.id
 ) update public.icash_legacy_contacts c set converted_at=p.paid_at,membership_id=p.membership_id,updated_at=now() from purchased p where p.id=c.id;
 update public.icash_legacy_contacts c set suppressed_reason='Refund or dispute in billing history',stopped_at=coalesce(stopped_at,now())
 where c.launch_id=p_launch and c.suppressed_reason is null and exists(
  select 1 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id
  join public.icash_billing_reviews r on r.payment_id=i.stripe_payment_id where m.mode='live' and ((c.email is not null and lower(trim(m.payer_email))=c.email) or (c.phone is not null and m.payer_phone=c.phone) or exists(select 1 from public.icash_legacy_checkouts b where b.contact_id=c.id and b.membership_id=m.id)));
 update public.icash_legacy_outbox o set state='cancelled',updated_at=now() from public.icash_legacy_contacts c
 where o.contact_id=c.id and c.launch_id=p_launch and o.state='queued'
 and (c.converted_at is not null or c.stopped_at is not null or c.suppressed_reason is not null or c.replied_at is not null);
end $$;

create or replace function public.icash_legacy_admit(p_contact uuid,p_channel text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_legacy_contacts c join public.icash_legacy_launches l on l.id=c.launch_id
 where c.id=p_contact and l.state='active' and l.approved_at is not null and l.approved_revision=l.revision and l.history_reviewed_at is not null and l.started_at is not null
 and now()>=greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')
 and now()<greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')+interval '30 days'
 and c.suppressed_reason is null and c.stopped_at is null and c.replied_at is null and c.converted_at is null
 and not exists(select 1 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id where m.mode='live' and ((c.email is not null and lower(trim(m.payer_email))=c.email) or (c.phone is not null and m.payer_phone=c.phone) or exists(select 1 from public.icash_legacy_checkouts b where b.contact_id=c.id and b.membership_id=m.id)))
 and not exists(select 1 from public.icash_legacy_contacts other where other.id<>c.id and ((c.email is not null and other.email=c.email) or (c.phone is not null and other.phone=c.phone)) and (other.stopped_at is not null or other.suppressed_reason is not null or other.converted_at is not null))
 and case when p_channel='email' then c.email is not null and c.email_permission
  and not exists(select 1 from public.icash_email_suppressions s where lower(s.email)=c.email)
  and not exists(select 1 from public.icash_webinar_suppressions s where lower(s.email)=c.email)
 when p_channel='sms' then c.phone is not null and c.sms_permission
  and not exists(select 1 from public.icash_text_suppressions s where s.phone=c.phone)
  and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=c.phone)
  and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(sha256(convert_to(c.phone,'UTF8')),'hex'))
 else false end);
$$;

create or replace function public.icash_legacy_payment_stop() returns trigger language plpgsql security invoker set search_path='' as $$
declare em text;ph text;l uuid;mid uuid;
begin
 if tg_table_name='icash_membership_invoices' then mid:=new.membership_id;select lower(trim(payer_email)),payer_phone into em,ph from public.icash_memberships where id=new.membership_id and mode='live';
 else mid:=new.id;if new.mode='live' then em:=lower(trim(new.payer_email));ph:=new.payer_phone;end if;end if;
 if mid is not null then
  for l in select distinct launch_id from public.icash_legacy_contacts where email=em or phone=ph or id in(select contact_id from public.icash_legacy_checkouts where membership_id=mid) loop perform public.icash_legacy_sync(l);end loop;
 end if;return new;
end $$;

