-- Keep optional aggregate work from holding earlier accounts' notification rows.
-- No source trigger, aggregate, financial gate or learning policy is changed.
-- The release runner owns the migration-ledger transaction.
set local lock_timeout='3s';
set local statement_timeout='15s';
do $patch$
declare d text;before_success text:=$old$
   update public.icash_learning_queue set due_at=case when generation=version then now()+interval '1 hour' else due_at end,
    last_refreshed_at=case when generation=version then now() else last_refreshed_at end,last_success_at=now(),last_attempt_at=now(),last_error_at=null,last_error_code=null where account_id=item.account_id;$old$;
 before_failure text:=$old$
   update public.icash_learning_queue set due_at=case when generation=version then now()+interval '5 minutes' else due_at end,last_attempt_at=now(),last_error_at=now(),last_error_code=last_code where account_id=item.account_id;$old$;
 retention text:=$old$ if not cancelled then delete from icash_learning_private.refresh_runs where id in(select id from icash_learning_private.refresh_runs where completed_at<now()-interval '7 days' order by id limit 1000);end if;$old$;
 boundary text:=$old$ select count(*) into due from public.icash_learning_queue where due_at<=now();$old$;
 finish text:=$new$
 -- All potentially expensive aggregation, operation review and retention precede
 -- these at-most-five row locks. Keep each concurrent notification generation.
 for completion in select * from jsonb_to_recordset(completions)
  as x(account_id uuid,generation bigint,error_code text) order by account_id loop
  if completion.error_code is null then
   update public.icash_learning_queue set due_at=case when generation=completion.generation then now()+interval '1 hour' else due_at end,
    last_refreshed_at=case when generation=completion.generation then now() else last_refreshed_at end,last_success_at=now(),last_attempt_at=now(),last_error_at=null,last_error_code=null where account_id=completion.account_id;
  else
   update public.icash_learning_queue set due_at=case when generation=completion.generation then now()+interval '5 minutes' else due_at end,last_attempt_at=now(),last_error_at=now(),last_error_code=completion.error_code where account_id=completion.account_id;
  end if;
 end loop;
$new$;
begin
 d:=pg_get_functiondef('public.icash_refresh_shared_learning(integer)'::regprocedure);
 if md5(d)<>'62d7625004e807cd463088b173dbba5d' then raise exception 'Learning completion predecessor changed';end if;
 if (length(d)-length(replace(d,before_success,'')))<>length(before_success)
  or (length(d)-length(replace(d,before_failure,'')))<>length(before_failure)
  or (length(d)-length(replace(d,retention,'')))<>length(retention)
  or (length(d)-length(replace(d,boundary,'')))<>length(boundary)
  or (length(d)-length(replace(d,'due integer;','')))<>length('due integer;')
 then raise exception 'Learning completion boundary changed';end if;
 d:=replace(d,'due integer;','due integer;completions jsonb:=''[]''::jsonb;completion record;');
 d:=replace(d,before_success,$new$
   completions:=completions||jsonb_build_array(jsonb_build_object('account_id',item.account_id,'generation',version,'error_code',null));$new$);
 d:=replace(d,before_failure,$new$
   completions:=completions||jsonb_build_array(jsonb_build_object('account_id',item.account_id,'generation',version,'error_code',last_code));$new$);
 d:=replace(d,retention,'');
 d:=replace(d,boundary,retention||finish||boundary);
 execute d;
end $patch$;
