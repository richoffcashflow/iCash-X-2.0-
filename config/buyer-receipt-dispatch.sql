begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The enclosing dispatcher already declares j as a job row. PostgreSQL resolves
-- the buyer reconciliation query only when its flag is enabled, including when
-- there are no waiting buyers. A distinct alias keeps that branch executable.
-- Preserve the deployed body, locks, grants, source gates and original receipts.
do $patch$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_issue_due_text_ai()'::regprocedure);
 old:='select j.account_id,j.id from public.icash_buyer_reply_progress b join public.icash_text_ai_jobs j on j.account_id=b.account_id and j.message_id=b.message_id';
 replacement:='select buyer_job.account_id,buyer_job.id from public.icash_buyer_reply_progress b join public.icash_text_ai_jobs buyer_job on buyer_job.account_id=b.account_id and buyer_job.message_id=b.message_id';
 if position(old in definition)=0 then raise exception 'Buyer receipt dispatcher changed; inspect before applying';end if;
 execute replace(definition,old,replacement);
end $patch$;
commit;
