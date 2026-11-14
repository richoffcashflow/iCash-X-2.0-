-- Detection only. Never settle, release, replay, or credit unfinished work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare source text:=pg_get_functiondef('public.icash_account_work_observations()'::regprocedure);
 needle text:=$old$when available<coalesce(minimum,1) and pending_at<=now()-interval '30 minutes' then 'pending_work'$old$;
 replacement text:=$new$when pending_at<=now()-interval '30 minutes'
    and (available<coalesce(minimum,1) or last_progress<=now()-interval '30 minutes') then 'pending_work'$new$;
begin
 if md5(source)<>'37f703a603daa4dd5e15ae049a15a71a'
  or (length(source)-length(replace(source,needle,'')))<>length(needle)
 then raise exception 'Stalled-work observation prerequisite changed';end if;
 -- A cheaper contact quote is not evidence that work has completed. An aged
 -- original operation remains visible across the contact/search funding gap.
 -- Recent independently completed work retains the existing healthy branch;
 -- pending_work is an unresolved-operation finding, not proof of a failed call.
 execute replace(source,needle,replacement);
end $patch$;
commit;
