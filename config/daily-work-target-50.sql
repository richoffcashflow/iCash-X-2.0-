-- The latest daily work goal is 50% of the verified funding baseline.
-- Preserve actual usage, reservations, fair scheduling and admission limits.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;
 baseline text:='baseline_cents::numeric*0.30';
 percent text:='''percent'',30';
begin
 definition:=pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,baseline,'')))<>length(baseline)
  or (length(definition)-length(replace(definition,percent,'')))<>length(percent) then
  raise exception 'Daily work target prerequisite changed';
 end if;
 execute replace(replace(definition,baseline,'baseline_cents::numeric*0.50'),percent,'''percent'',50');
end $patch$;
commit;
