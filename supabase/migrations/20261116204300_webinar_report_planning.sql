-- Keep variable reporting windows from sharing an undersized generic plan.
-- The exact reviewed function body, privileges and request deadlines stay intact.
do $migration$
begin
 if md5(pg_get_functiondef('public.icash_webinar_report_with_funnel(text,text)'::regprocedure))
  <> 'd0cf08efe4c4536d11c0fa8921cf4c81' then
  raise exception 'Webinar report source changed; review before applying the planning repair';
 end if;
 alter function public.icash_webinar_report_with_funnel(text,text)
  set plan_cache_mode to force_custom_plan;
end $migration$;
