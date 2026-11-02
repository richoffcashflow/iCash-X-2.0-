-- Receipt recovery must not hold a queue row while waiting for the parent
-- account that ordinary dispatch already holds. Lock both eligible rows with
-- SKIP LOCKED; a busy account yields to the next due account. The parent key
-- share also satisfies the new ticket's foreign-key check without a new wait.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.icash_issue_account_followup()'::regprocedure);
 original:='select f.* into q from icash_work_private.account_followups f';
 if position(original in definition)=0 or position('order by f.next_run_at,f.account_id for update of f skip locked limit 1;' in definition)=0 then
  raise exception 'Account recovery claim prerequisite changed';
 end if;
 definition:=replace(definition,original,original||' join public.icash_accounts recovery_account on recovery_account.id=f.account_id');
 definition:=replace(definition,'order by f.next_run_at,f.account_id for update of f skip locked limit 1;',
  'order by f.next_run_at,f.account_id for key share of recovery_account skip locked for update of f skip locked limit 1;');
 execute definition;
end $patch$;
commit;
