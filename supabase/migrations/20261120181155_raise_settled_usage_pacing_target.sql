-- Pace eligible work with settled usage. This migration has no billing,
-- reservation, allowance, contact-eligibility or rate writes.
set local lock_timeout='2s';
create function icash_work_private.platform_usage_pace(p_include_owner boolean)
returns jsonb language sql stable set search_path='' as $fn$
 with observed as (
  select coalesce(sum(greatest(0,o.charged_cents-coalesce(c.covered_cents,0))),0)::bigint as cents
  from public.icash_operation_spend o join public.icash_accounts a on a.id=o.account_id
  left join public.icash_duplicate_discovery_coverage c on c.operation_key=o.operation_key and c.account_id=o.account_id
  where o.state='settled' and o.charged_cents>0 and o.settled_at between now()-interval '24 hours' and now()
   and (p_include_owner or a.owner_user_id is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid)
 )
 select jsonb_build_object('settledCents',cents,'minimumCents',50000,'targetCents',75000,'windowHours',24,
  'prioritySeconds',case when cents<50000 then 50 when cents<75000 then 45 else 30 end)
 from observed
$fn$;
revoke all on function icash_work_private.platform_usage_pace(boolean) from public,anon,authenticated;
grant execute on function icash_work_private.platform_usage_pace(boolean) to service_role;
do $patch$
declare src text:=pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure);
begin
 if md5(src)<>'40c0467f3e5d457057a60806df8a29f1' then raise exception 'Unexpected icash_daily_work_target predecessor';end if;
 src:=replace(src,$old$baseline_cents::numeric*0.50$old$,$new$baseline_cents::numeric*0.80$new$);
 src:=replace(src,$old$'percent',50$old$,$new$'percent',80$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('icash_work_private.daily_work_priority(uuid)'::regprocedure);
begin
 if md5(src)<>'149c1c73eb2c09d5b6086ba4ae9ab8cb' then raise exception 'Unexpected daily_work_priority predecessor';end if;
 src:=replace(src,$old$baseline_cents::numeric*0.50$old$,$new$baseline_cents::numeric*0.80$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_usage_loop_report(uuid,boolean)'::regprocedure);
begin
 if md5(src)<>'9499e0a7ba537cb0e1b7adf79349c759' then raise exception 'Unexpected icash_usage_loop_report predecessor';end if;
 src:=replace(src,$old$ return report;$old$,$new$ return report||jsonb_build_object('dailyUsage',icash_work_private.platform_usage_pace(p_include_owner));$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_issue_ready_seller_text()'::regprocedure);
begin
 if md5(src)<>'7f6136e8ba3ec987b9dfab59be802cef' then raise exception 'Unexpected icash_issue_ready_seller_text predecessor';end if;
 src:=replace(src,$old$extract(second from statement_timestamp())<30$old$,$new$(extract(second from statement_timestamp())<30 or
   (extract(second from statement_timestamp())<50 and extract(second from statement_timestamp())<
    (select (icash_work_private.platform_usage_pace(false)->>'prioritySeconds')::int)))$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
begin
 if md5(src)<>'13567012ca6c02d4981af55869ffa752' then raise exception 'Unexpected icash_issue_ready_voice_ticket predecessor';end if;
 src:=replace(src,$old$extract(second from statement_timestamp())<30$old$,$new$(extract(second from statement_timestamp())<30 or
   (extract(second from statement_timestamp())<50 and extract(second from statement_timestamp())<
    (select (icash_work_private.platform_usage_pace(false)->>'prioritySeconds')::int)))$new$);
 execute src;
end $patch$;
