-- Owner policy: at least 5x fully-loaded buffered cost, with no fixed company daily dollar cap.
-- Customer pacing and company cash/protected-reserve constraints remain enforced.
alter table public.icash_operating_budget alter column minimum_margin_bps set default 8000;
alter table public.icash_operating_budget alter column daily_limit_micros drop not null;
alter table public.icash_operating_budget alter column daily_limit_micros set default null;
update public.icash_operating_budget set minimum_margin_bps=8000,daily_limit_micros=null where id=1;
comment on column public.icash_operating_budget.daily_limit_micros is 'Optional company daily cap in USD micros. NULL means no fixed daily cap; zero blocks positive spend. Cash, protected reserves, customer limits and margin gates still apply.';
