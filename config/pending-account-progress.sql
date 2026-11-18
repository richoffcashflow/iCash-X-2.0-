-- Surface a full day without completed work even when an unresolved operation remains open.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare target regprocedure:='public.icash_refresh_work_before_incoming_texts()'::regprocedure; source text; anchor text; patched text;
begin
 source:=pg_get_functiondef(target);
 if md5(source)<>'45b39fb474ec4e8c814667f8a40143a7' or not exists(select 1 from pg_proc where oid=target
  and proowner='postgres'::regrole and proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  and not prosecdef and provolatile='v' and proconfig=array['search_path=""','statement_timeout=10s']) then raise exception 'Unexpected public.icash_refresh_work_before_incoming_texts() predecessor or authority';end if;
 patched:=source;
 anchor:=$old$'stalledAccounts',count(*) filter(where reason='no_completed_work'),$old$;
 if length(patched)-length(replace(patched,anchor,''))<>length(anchor) then raise exception 'Expected unique public.icash_refresh_work_before_incoming_texts() source anchor';end if;
 patched:=replace(patched,anchor,$new$'stalledAccounts',count(*) filter(where reason='no_completed_work' or (reason='pending_work' and coalesce(last_completed_at,since)<=now()-interval '24 hours')),
  'stalledPendingAccounts',count(*) filter(where reason='pending_work' and coalesce(last_completed_at,since)<=now()-interval '24 hours'),$new$);
 execute patched;
 if pg_get_functiondef(target)<>patched then raise exception 'Unexpected public.icash_refresh_work_before_incoming_texts() readback';end if;
end $patch$;
