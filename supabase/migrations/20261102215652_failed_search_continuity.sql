-- A completed HTTP 500 must not freeze an otherwise eligible nationwide bot
-- in the failed ZIP. Keep the original purchase and its money hold untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.settings
 add column completed_error_continuation_enabled boolean not null default false;
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.icash_continue_stalled_research(uuid)'::regprocedure);
 if md5(d)<>'89cfed2f8e5af6310646dd5d920382c6' then raise exception 'Stalled research continuation prerequisite changed';end if;
 d:=replace(d,'op text;quote bigint;','op text;quote bigint;completed_errors boolean;');
 d:=replace(d,'perform 1 from public.icash_operating_budget where id=1 and enabled for update;',
  'select completed_error_continuation_enabled into completed_errors from icash_research_private.settings where id=1;'||E'\n perform 1 from public.icash_operating_budget where id=1 and enabled for update;');
 d:=replace(d,'or c.research_version<>2 or c.research_list_id is null then return false;end if;',
  'or c.research_version<>2 or (c.research_list_id is null and not coalesce(completed_errors,false)) then return false;end if;');
 d:=replace(d,'and kind=''property_search'' and admitted and result->>''outcome''=''unknown''',
  'and kind=''property_search'' and admitted and ((c.research_list_id is not null and result->>''outcome''=''unknown'')'||E'\n   or (completed_errors and result->>''outcome''=''http_error'' and result->''httpStatus''=''500''::jsonb))');
 execute d;
end $patch$;
commit;
