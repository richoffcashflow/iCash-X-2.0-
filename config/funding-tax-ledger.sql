alter table public.icash_funding_orders
 add column if not exists processing_fee_cents bigint not null default 0 check(processing_fee_cents>=0),
 add column if not exists tax_required boolean not null default false,
 add column if not exists tax_cents bigint not null default 0 check(tax_cents>=0),
 add column if not exists charged_total_cents bigint;
create or replace function public.icash_settle_taxed_funding(p_order uuid,p_mode text,p_session text,p_payment text,p_amount bigint,p_tax bigint,p_email text,p_phone text) returns void
language plpgsql set search_path='' as $$
declare o public.icash_funding_orders;
begin
 select * into o from public.icash_funding_orders where id=p_order for update;
 if not found or p_tax is null or p_tax<0 or p_amount is null or p_amount<>o.price_cents+p_tax or (not o.tax_required and p_tax<>0) or (o.state='paid' and o.charged_total_cents is not null and (o.charged_total_cents<>p_amount or o.tax_cents<>p_tax)) then raise exception 'Tax/payment mismatch'; end if;
 perform public.icash_settle_funding(p_order,p_mode,p_session,p_payment,o.price_cents,p_email,p_phone);
 update public.icash_funding_orders set tax_cents=p_tax,charged_total_cents=p_amount where id=p_order;
end $$;
revoke all on function public.icash_settle_taxed_funding(uuid,text,text,text,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.icash_settle_taxed_funding(uuid,text,text,text,bigint,bigint,text,text) to service_role;
