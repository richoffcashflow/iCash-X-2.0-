-- Recognize the provider's specific no-records code for the existing empty
-- export policy. The existing three inventory reads still decide capacity.
-- The migration runner owns the transaction and its history entry.
set local lock_timeout='500ms';
set local statement_timeout='8s';
do $repair$
declare
 signature constant regprocedure:='icash_research_private.capacity_source_before_unknown(uuid,text)'::regprocedure;
 original text; patched text;
 needle constant text:=$old$  and e.receipt->'raw'=jsonb_build_object('error',jsonb_build_object('code','invalid_request',$old$;
 replacement constant text:=$new$  and (e.receipt#>>'{raw,error,code}'='invalid_request'
   or (e.receipt#>>'{raw,error,code}'='no_records_matched'
    and (e.receipt-array['httpStatus','raw','rawText'])='{}'::jsonb
    and e.artifact_sha256 is null and e.parsed_rows is null and b.results is null
    and e.recovery_history='[]'::jsonb))
  and e.receipt->'raw'=jsonb_build_object('error',jsonb_build_object('code',e.receipt#>>'{raw,error,code}',$new$;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then
  raise exception 'Owner export capacity review is busy';
 end if;
 original:=pg_get_functiondef(signature);
 if md5(original)<>'8345639c552e5f75dcad80b9f9f7bf4e'
  or md5(pg_get_functiondef('icash_research_private.capacity_source_before_empty(uuid,text)'::regprocedure))<>'45ba0074ed0c1d307383a9822d8f8cf8'
  or not exists(select 1 from pg_proc where oid=signature and proowner='postgres'::regrole
   and not prosecdef and provolatile='s' and proconfig=array['search_path=""'] and proacl::text='{postgres=X/postgres}')
  or (length(original)-length(replace(original,needle,'')))<>length(needle) then
  raise exception 'Empty export capacity predecessor changed';
 end if;
 patched:=replace(original,needle,replacement);
 execute patched;
 if pg_get_functiondef(signature)<>patched then raise exception 'Empty export capacity readback changed';end if;
end $repair$;
