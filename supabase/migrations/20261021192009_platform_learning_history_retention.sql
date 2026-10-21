-- Retain seven days of only this feature's scheduler history.
select cron.schedule('icash-shared-learning-history','15 3 * * *','set lock_timeout=''1s'';set statement_timeout=''12s'';delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname in(''icash-shared-learning-refresh'',''icash-shared-learning-history'')) and end_time<now()-interval ''7 days'';');
