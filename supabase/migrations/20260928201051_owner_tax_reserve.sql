alter table public.icash_operating_budget add column tax_reserve_bps integer not null default 3500 check(tax_reserve_bps between 0 and 10000);
comment on column public.icash_operating_budget.tax_reserve_bps is 'Owner-selected planning reserve on positive estimated pre-tax profit; not a statutory tax rate or a transfer of funds.';
