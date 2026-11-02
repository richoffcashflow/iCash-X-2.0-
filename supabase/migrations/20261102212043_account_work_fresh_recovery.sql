-- A stale account snapshot is not an observation of recovery.
begin;
set local lock_timeout='5s';
do $patch$
declare d text;needle text:='if component_name=''account_progress'' and report->''snapshot''->''accountProgress'' is null then continue;end if;';
begin
 d:=pg_get_functiondef('public.icash_refresh_reliability_incident(text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Account outage observation guard changed';end if;
 execute replace(d,needle,'if component_name=''account_progress'' and (report->''snapshot''->''accountProgress'' is null or (report->''snapshot''->''accountProgress''->>''checkedAt'')::timestamptz<=now()-interval ''3 minutes'') then continue;end if;');
end $patch$;
commit;
