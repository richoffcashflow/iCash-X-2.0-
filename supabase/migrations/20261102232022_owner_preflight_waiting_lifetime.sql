-- A due free check must survive the scheduler's five-minute fairness window.
-- Keep the original handler leases, receipt validity and paid admission intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;created text;cohort_window text;
begin
 created:=$proof$p.list_id is not null and p.receipts->'create'->'httpStatus'='200'::jsonb
 and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
 and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
 and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
 and p.receipts->'create'->'raw'->'data'->>'status'='completed'
 and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(jsonb_array_length(p.request->'people_ids'))$proof$;
 d:=pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure);
 if md5(d)<>'dde8923ad1354f4c983d5d27b5e3c1fb' then raise exception 'Owner cleanup prerequisite changed';end if;
 needle:=$old$(state in ('empty','ready','held') or started_at<clock_timestamp()-interval '5 minutes')$old$;
 if strpos(d,needle)=0 then raise exception 'Owner cleanup window changed';end if;
 execute replace(d,needle,$new$(state in ('empty','ready','held') or
 case when state='waiting' and ($new$||replace(created,'p.','')||$new$) then created_at<=clock_timestamp()-interval '30 minutes'
 else started_at<clock_timestamp()-interval '5 minutes' end)$new$);

 -- Retain the original cohort through its delayed count and immediate positive
 -- admission. Known lists have one bounded lifetime; unknown creation stays short.
 cohort_window:=$window$(p.created_at>now()-interval '5 minutes' or
 (p.created_at>now()-interval '30 minutes' and p.state in ('waiting','checking','ready') and ($window$||created||')))';
 d:=pg_get_functiondef('icash_research_private.owner_preflight_cohort(uuid,uuid)'::regprocedure);
 if md5(d)<>'a8fa4bf58294a7ad8529b646b9f00912' then raise exception 'Owner cohort prerequisite changed';end if;
 needle:='p.created_at>now()-interval ''5 minutes''';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner cohort window changed';end if;
 execute replace(d,needle,cohort_window);
 d:=pg_get_functiondef('public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)'::regprocedure);
 if md5(d)<>'5d5ca82caf5f71a3449b5e6dd31b229a' then raise exception 'Owner sibling prerequisite changed';end if;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner sibling window changed';end if;
 execute replace(d,needle,cohort_window);
end $patch$;
commit;
