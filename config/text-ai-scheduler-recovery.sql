-- Preserve the complete issuer and its admission/receipt checks. The buyer
-- recovery alias collided with the existing PL/pgSQL row variable named j,
-- raising 42702 before even an empty buyer scan could reach seller work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text; original text; corrected text;
begin
 definition:=pg_get_functiondef('public.icash_issue_due_text_ai()'::regprocedure);
 original:='for p in select j.account_id,j.id from public.icash_buyer_reply_progress b join public.icash_text_ai_jobs j on j.account_id=b.account_id and j.message_id=b.message_id';
 corrected:='for p in select buyer_job.account_id,buyer_job.id from public.icash_buyer_reply_progress b join public.icash_text_ai_jobs buyer_job on buyer_job.account_id=b.account_id and buyer_job.message_id=b.message_id';
 if position(original in definition)=0 then raise exception 'Buyer scheduler recovery prerequisite changed';end if;
 execute replace(definition,original,corrected);
end $patch$;
commit;
