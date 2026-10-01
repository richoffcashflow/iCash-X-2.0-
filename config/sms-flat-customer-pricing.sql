begin;
-- Apply after sms-contact-intake.sql. Schema only: no price, rate, contact or campaign enabled.
-- An explicit owner-reviewed SMS price replaces markup, never the supplier cost estimate.
alter table public.icash_operation_rates add column flat_customer_price_cents bigint;
alter table public.icash_operation_rates add constraint icash_sms_flat_customer_price
 check(flat_customer_price_cents is null or (operation='sms_send' and flat_customer_price_cents>0 and flat_customer_price_cents=charge_cents));
comment on column public.icash_operation_rates.flat_customer_price_cents is 'Immutable SMS-only owner price override. Complete buffered costs must still fit; all other rates keep ordinary multipliers.';

do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_sms_intake_rate_current(uuid)'::regprocedure);
 needle:=' return coalesce(price>=required and r.charge_cents>=ceil(price::numeric/10000),false);';
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'SMS intake price boundary changed';end if;
 execute replace(def,needle,$n$
 if r.flat_customer_price_cents is not null then
  required:=ceil(total*(10000+r.buffer_bps)/10000);
  return coalesce(price=r.flat_customer_price_cents::numeric*10000 and price>=required,false);
 end if;
 return coalesce(price>=required and r.charge_cents>=ceil(price::numeric/10000),false);$n$);

 def:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=' if price is null or price<required then raise exception ''Price below provider cost multiplier'';end if;';
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'Operation price boundary changed';end if;
 execute replace(def,needle,$n$
 if r.flat_customer_price_cents is not null then
  if r.operation<>'sms_send' or price is distinct from r.flat_customer_price_cents::numeric*10000 then raise exception 'SMS flat price snapshot mismatch';end if;
  -- Snapshot cost-coverage accounting only for this explicit flat-price operation.
  -- The existing fractional ledger charges the immutable customer_price_micros.
  required:=held;b.standard_cost_multiplier:=1;b.elevenlabs_cost_multiplier:=1;
 end if;
 if price is null or price<required then raise exception 'Price below provider cost multiplier';end if;$n$);
end $patch$;
commit;
