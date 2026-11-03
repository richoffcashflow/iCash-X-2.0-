begin;
set local lock_timeout='5s';
-- Reuse the existing receipt-based 24-hour classification. An active lease or
-- outgoing delivery is not proof that the same line can receive seller replies.
-- Observation only: no provider probes, sender changes or outreach replay.
alter function public.icash_refresh_account_work_snapshot() rename to icash_refresh_work_before_incoming_texts;
create function public.icash_refresh_account_work_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare v_report jsonb;previous_incoming jsonb;health jsonb;incoming jsonb;lines jsonb;warning_count integer;
begin
 perform pg_advisory_xact_lock(916014);
 select report->'incomingTexts' into previous_incoming from icash_reliability_private.snapshots where id=1;
 v_report:=public.icash_refresh_work_before_incoming_texts();
 begin
  health:=public.icash_owner_text_health('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid);
  if health is null or jsonb_typeof(health->'lines') is distinct from 'array' or health->>'checkedAt' is null
   or (health->>'checkedAt')::timestamptz not between now()-interval '3 minutes' and now() then
   raise exception 'Incoming text observation unavailable';
  end if;
  with warnings as materialized (
   select line from jsonb_array_elements(health->'lines') line where line->'enabled'='true'::jsonb
    and line->>'incomingStatus' in ('unverified','blocking_reported') and (line->>'propertyAccepted24h')::bigint>0
  ), samples as (select line from warnings order by line->>'phone' limit 50)
  select (select count(*)::integer from warnings),coalesce(jsonb_agg(jsonb_build_object('phone',line->>'phone','incomingStatus',line->>'incomingStatus','lastIncomingAt',line->'lastIncomingAt',
   'propertyAccepted24h',line->'propertyAccepted24h','propertyDelivered24h',line->'propertyDelivered24h') order by line->>'phone'),'[]'::jsonb)
  into warning_count,lines from samples;
  incoming:=jsonb_build_object('checkedAt',health->'checkedAt','fresh',true,'warningCount',warning_count,'lines',lines);
 exception when others then
  -- Preserve earlier evidence without rolling back independent account/work
  -- observations. An unavailable read cannot create a false recovered report.
  incoming:=jsonb_build_object('checkedAt',previous_incoming->'checkedAt','fresh',false,
   'warningCount',greatest(1,coalesce((previous_incoming->>'warningCount')::integer,0)),
   'lines',coalesce(previous_incoming->'lines','[]'::jsonb));
 end;
 v_report:=v_report||jsonb_build_object('incomingTexts',incoming,'issueCount',
  (v_report->>'issueCount')::integer-coalesce((v_report->'incomingTexts'->>'warningCount')::integer,0)+(incoming->>'warningCount')::integer);
 update icash_reliability_private.snapshots set report=v_report where id=1;
 return v_report;
end $function$;
revoke all on function public.icash_refresh_work_before_incoming_texts(),public.icash_refresh_account_work_snapshot() from public,anon,authenticated;
grant execute on function public.icash_refresh_work_before_incoming_texts(),public.icash_refresh_account_work_snapshot() to service_role;
commit;
