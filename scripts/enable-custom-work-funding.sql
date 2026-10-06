-- One-time custom purchases use this product identity. The validated purchase
-- amount is snapshotted on each funding order, then matched at settlement.
insert into public.icash_credit_packs(code,price_cents,credit_cents,enabled,currency)
values ('work_custom',1000,1000,true,'USD')
on conflict (code) do nothing;
