-- Once cleanup has started, the free check is no longer reusable. Preserve
-- ordinary bounded cleanup retries instead of extending that unusable wait.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text:='case when state=''waiting'' and (';
begin
 d:=pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure);
 if md5(d)<>'4382cbfa497be404b8b11a2a1b485332' then raise exception 'Owner waiting cleanup prerequisite changed';end if;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner waiting cleanup predicate changed';end if;
 execute replace(d,needle,'case when state=''waiting'' and cleanup_attempts=0 and (');
end $patch$;
commit;
