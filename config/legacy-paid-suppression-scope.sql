-- Exact receipt-backed suppression only; never run launch maintenance in settlement.
-- Apply transactionally after reviewed index sizing/lock-window verification.
set local lock_timeout='2s';
do $$begin
 if md5(pg_get_functiondef('public.icash_legacy_payment_stop()'::regprocedure))<>'ca896a455cc82ced8ef9eb1e1d49615d' then
  raise exception 'Legacy payment trigger predecessor changed';
 end if;
end$$;
create index if not exists icash_legacy_contacts_payment_email on public.icash_legacy_contacts(email) where email is not null;
create index if not exists icash_memberships_legacy_live_email_norm_idx on public.icash_memberships(lower(trim(payer_email))) include(id) where mode='live';
create index if not exists icash_memberships_legacy_live_phone_idx on public.icash_memberships(payer_phone) include(id) where mode='live';

do $$declare r record;begin
 for r in select * from (values
 ('icash_legacy_contacts_payment_email','CREATE INDEX icash_legacy_contacts_payment_email ON public.icash_legacy_contacts USING btree (email) WHERE (email IS NOT NULL)'),
 ('icash_memberships_legacy_live_email_norm_idx','CREATE INDEX icash_memberships_legacy_live_email_norm_idx ON public.icash_memberships USING btree (lower(TRIM(BOTH FROM payer_email))) INCLUDE (id) WHERE (mode = ''live''::text)'),
 ('icash_memberships_legacy_live_phone_idx','CREATE INDEX icash_memberships_legacy_live_phone_idx ON public.icash_memberships USING btree (payer_phone) INCLUDE (id) WHERE (mode = ''live''::text)')
 ) expected(name,definition) loop
  if pg_get_indexdef(to_regclass('public.'||r.name)) is distinct from r.definition or not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||r.name) and indisvalid and indisready) then
   raise exception 'Suppression index definition changed: %',r.name;
  end if;
 end loop;
end$$;

create or replace function public.icash_legacy_payment_stop() returns trigger language plpgsql security invoker set search_path='' as $$
declare mid uuid;em text;ph text;target uuid;c public.icash_legacy_contacts;paid_at timestamptz;paid_member uuid;reviewed boolean;
begin
 if tg_table_name='icash_membership_invoices' then mid:=new.membership_id;
 else mid:=new.id;end if;
 select lower(trim(m.payer_email)),m.payer_phone into em,ph from public.icash_memberships m where m.id=mid and m.mode='live';
 if not found then return new;end if;
 -- UNION preserves every match across launches without duplicate work or an
 -- arbitrary cap. Each branch has an identity-leading index.
 for target in
  select id from public.icash_legacy_contacts where email=em
  union select id from public.icash_legacy_contacts where phone=ph
  union select contact_id from public.icash_legacy_checkouts where membership_id=mid
  order by 1
 loop
  -- Delivery can own an outbox row before updating a contact. Fail visibly
  -- instead of waiting in an inverse lock order; settlement rolls back intact.
  select * into c from public.icash_legacy_contacts where id=target for update nowait;
  with matches as materialized (
   select m.id from public.icash_memberships m where m.mode='live' and lower(trim(m.payer_email))=c.email
   union select m.id from public.icash_memberships m where m.mode='live' and m.payer_phone=c.phone
   union select m.id from public.icash_legacy_checkouts b join public.icash_memberships m on m.id=b.membership_id and m.mode='live' where b.contact_id=c.id
  ), receipts as materialized (
   select i.* from matches m join public.icash_membership_invoices i on i.membership_id=m.id
  )
  select (select recorded_at from receipts order by recorded_at,membership_id,stripe_invoice_id limit 1),
         (select membership_id from receipts order by recorded_at,membership_id,stripe_invoice_id limit 1),
         exists(select 1 from receipts i join public.icash_billing_reviews r on r.payment_id=i.stripe_payment_id)
  into paid_at,paid_member,reviewed;
  if paid_at is not null then
   update public.icash_legacy_contacts set converted_at=paid_at,membership_id=paid_member,updated_at=now() where id=c.id and converted_at is null;
  end if;
  if reviewed then
   update public.icash_legacy_contacts set suppressed_reason='Refund or dispute in billing history',stopped_at=coalesce(stopped_at,now()) where id=c.id and suppressed_reason is null;
  end if;
  if exists(select 1 from public.icash_legacy_contacts where id=c.id and (converted_at is not null or stopped_at is not null or suppressed_reason is not null or replied_at is not null)) then
   perform 1 from public.icash_legacy_outbox where contact_id=c.id and state='queued' order by id for update nowait;
   update public.icash_legacy_outbox set state='cancelled',updated_at=now() where contact_id=c.id and state='queued';
  end if;
 end loop;
 return new;
end$$;
