-- Run only after the matching application release is verified. No counters are reset.
begin;
set local lock_timeout='5s';
do $activate$
declare b public.icash_dealmachine_request_budget;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if b.day_start is null or b.day_start>clock_timestamp() or b.day_start<=clock_timestamp()-interval '24 hours' or b.day_limit<>9800 or b.minute_limit<>60 then raise exception 'A current normal quota window and unchanged limits are required';end if;
 if md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamp with time zone)'::regprocedure))<>'383bbfa915185d9aa33662c84647c450' then raise exception 'Released pacing function changed';end if;
 if md5(pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure))<>'2182dcab3cb6a780911298ae8fbb8da7' then raise exception 'Released pacing function changed';end if;
 if md5(pg_get_functiondef('icash_research_quota_status()'::regprocedure))<>'e0cebd09c20c7275f6329eb445487c75' then raise exception 'Released pacing function changed';end if;
 if md5(pg_get_functiondef('icash_research_private.maintenance_exclusion_allowed(text,timestamp with time zone)'::regprocedure))<>'583c3f28d807df605743574cfc538475' then raise exception 'Released pacing function changed';end if;
 if md5(pg_get_functiondef('icash_research_private.maintenance_capacity_available(timestamp with time zone)'::regprocedure))<>'8df34b90a5211adc1becbb39d9514540' then raise exception 'Released pacing function changed';end if;
 if md5(pg_get_functiondef('icash_claim_research_exclusions()'::regprocedure))<>'b07f55b19b1f5467bf5e78f82ce65050' then raise exception 'Released pacing function changed';end if;
 if not exists(select 1 from icash_research_private.request_pacing_policy where id=1 and not enabled and activate_after is null and maintenance_requests=196 and burst_seconds=3600) then raise exception 'Pristine disabled pacing policy required';end if;
 update icash_research_private.request_pacing_policy set enabled=true,activate_after=b.day_start+interval '24 hours' where id=1;
end $activate$;
commit;
