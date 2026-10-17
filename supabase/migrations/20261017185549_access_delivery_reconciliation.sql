begin;

-- Recover only missing instructions for recent, still-unclaimed paid access.
-- Existing sends, uncertain attempts and failed rows are never reset or replayed.
create function public.icash_queue_missing_purchase_access_emails() returns integer
language plpgsql security invoker set search_path='' as $$
declare queued integer;
begin
 insert into public.icash_purchase_access_emails(membership_id,invoice_id,recipient)
 select m.id,i.stripe_invoice_id,lower(trim(m.payer_email))
 from public.icash_memberships m
 join lateral(select * from public.icash_membership_invoices invoice
  where invoice.membership_id=m.id and invoice.amount_cents>0
  order by invoice.recorded_at,invoice.stripe_invoice_id limit 1) i on true
 where m.mode='live' and m.state='active' and m.paid_through>now() and m.account_id is null
 and i.recorded_at>=now()-interval '30 days'
 and length(trim(m.payer_email))<=254 and trim(m.payer_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 and not exists(select 1 from public.icash_purchase_access_emails e where e.membership_id=m.id)
 and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=i.stripe_payment_id and r.resolved_at is null)
 and not exists(select 1 from public.icash_email_suppressions s where s.email=lower(trim(m.payer_email)))
 and not exists(select 1 from public.icash_webinar_suppressions s where s.email=lower(trim(m.payer_email)) and s.reason ~* '(bounc|complain|suppress)')
 and not exists(select 1 from public.icash_purchase_access_emails e where e.recipient=lower(trim(m.payer_email)) and e.delivery in ('bounced','complained','suppressed'))
 order by i.recorded_at,m.id limit 50
 on conflict(membership_id) do nothing;
 get diagnostics queued=row_count;
 return queued;
end $$;
revoke all on function public.icash_queue_missing_purchase_access_emails() from public,anon,authenticated;
grant execute on function public.icash_queue_missing_purchase_access_emails() to service_role;

-- Provider webhooks may arrive out of order. A late delay cannot undo delivery;
-- actual failures/complaints still take precedence and retain suppression.
do $$
declare definition text; original text; replacement text;
begin
 definition:=pg_get_functiondef('public.icash_purchase_access_email_delivery(uuid,text,text,text)'::regprocedure);
 original:='delivery=case when delivery in (''bounced'',''complained'',''failed'',''suppressed'') then delivery else p_kind end';
 replacement:='delivery=case when delivery in (''bounced'',''complained'',''failed'',''suppressed'') then delivery when delivery=''delivered'' and p_kind=''delivery_delayed'' then delivery else p_kind end';
 if position(original in definition)=0 then raise exception 'Purchase email delivery definition changed';end if;
 execute replace(definition,original,replacement);
end $$;
commit;
