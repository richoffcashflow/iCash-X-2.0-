-- Smaller configurable budget increments; does not enable live purchases.
insert into public.icash_credit_packs (code,price_cents,credit_cents,enabled,currency)
select 'budget_'||d, d*100, d*100, false, 'USD'
from (select generate_series(25,95,5) d union select generate_series(125,225,25) union select generate_series(300,1000,50)) amounts
where not exists(select 1 from public.icash_credit_packs p where p.price_cents=d*100)
on conflict (code) do nothing;

insert into public.icash_credit_packs(code,price_cents,credit_cents,enabled,currency) values ('budget_ten',1000,1000,false,'USD'),('budget_fifteen',1500,1500,false,'USD') on conflict(code) do nothing;
