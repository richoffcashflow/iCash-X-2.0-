-- Only new daily quotes use the new minimum. Existing paid invoices are unchanged.
alter table public.icash_daily_quotes drop constraint icash_daily_quotes_budget_cents_check;
alter table public.icash_daily_quotes add constraint icash_daily_quotes_budget_cents_check check(budget_cents between 1000 and 100000) not valid;
insert into public.icash_credit_packs(code,price_cents,credit_cents,enabled) values('budget_ten',1000,1000,true) on conflict(code) do nothing;
update public.icash_credit_packs set enabled=false where price_cents<1000 and enabled;
