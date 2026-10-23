-- A failed provider read must not repeatedly occupy the first maintenance rows.
-- This timestamp is a bounded retry claim, never evidence of a financial outcome.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_customer_phone_calls add column if not exists reconciliation_checked_at timestamptz;
create index if not exists icash_customer_phone_reconciliation_due
 on public.icash_customer_phone_calls(reconciliation_checked_at nulls first,id)
 where settled_at is null;
commit;
