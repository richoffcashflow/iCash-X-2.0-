-- Enable the private database scheduler for receipt-only aggregate refreshes.
create extension if not exists pg_cron;
revoke usage on schema cron from public,anon,authenticated;
