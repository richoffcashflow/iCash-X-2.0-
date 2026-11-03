-- Current acquisition admission excludes live tickets; historical completed and
-- held tickets must not be visited for every account on every scheduler turn.
-- This changes only the access path. The existing predicate and locks remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_automation_account_active
 on public.icash_automation_tickets(account_id,state,expires_at,created_at)
 where state in ('issued','consumed');
commit;
