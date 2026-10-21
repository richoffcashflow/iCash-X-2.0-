-- Two receipt-only aggregate refreshes per tick; no provider calls.
select cron.schedule('icash-shared-learning-refresh','15 seconds',
 'set lock_timeout=''1s'';set statement_timeout=''12s'';select public.icash_refresh_shared_learning(2);');
