-- Leave bounded room for the optimized 30-day report inside the 15-second fetch.
-- Only this service-only reporting RPC receives the 12-second database deadline.
do $migration$
begin
 if md5(pg_get_functiondef('public.icash_webinar_report_with_funnel(text,text)'::regprocedure))
  <> '65639530a3c096a43019c05a770ed5d7' then
  raise exception 'Webinar report source changed; review before applying the report deadline';
 end if;
 alter function public.icash_webinar_report_with_funnel(text,text)
  set statement_timeout to '12s';
end $migration$;
notify pgrst, 'reload schema';
