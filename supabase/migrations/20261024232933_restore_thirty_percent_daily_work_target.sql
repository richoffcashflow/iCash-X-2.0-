-- The owner's latest daily usage goal is 30% rather than 25%. Change only
-- scheduling targets; preserve actual usage, reservations and admission limits.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;
 baseline text:='baseline_cents::numeric*0.25';
 percent text:='''percent'',25';
begin
 definition:=pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,baseline,'')))<>length(baseline)
  or (length(definition)-length(replace(definition,percent,'')))<>length(percent) then
  raise exception 'Daily work target prerequisite changed';
 end if;
 execute replace(replace(definition,baseline,'baseline_cents::numeric*0.30'),percent,'''percent'',30');
end $patch$;
commit;
