-- Count bound zero-duration terminal calls separately from calls whose outcome is unknown.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare target regprocedure:='public.icash_seller_conversion_report(uuid,integer)'::regprocedure; source text; anchor text; patched text;
begin
 source:=pg_get_functiondef(target);
 if md5(source)<>'df23fe55c34cd7a2a4fc10d216afddf8' or not exists(select 1 from pg_proc where oid=target
  and proowner='postgres'::regrole and proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  and prosecdef and provolatile='s' and proconfig=array['search_path=""','statement_timeout=8s']) then raise exception 'Unexpected public.icash_seller_conversion_report(uuid,integer) predecessor or authority';end if;
 patched:=source;
 anchor:=$old$   c.state='complete' and c.completed_at<=finish and public.icash_call_has_seller_response(c.result) human_response$old$;
 if length(patched)-length(replace(patched,anchor,''))<>length(anchor) then raise exception 'Expected unique public.icash_seller_conversion_report(uuid,integer) source anchor';end if;
 patched:=replace(patched,anchor,$new$   c.state='complete' and c.completed_at<=finish and public.icash_call_has_seller_response(c.result) human_response,
   r.conversation_id is null and r.start_claimed_at is null and r.recording_sid is null
   and not exists(select 1 from public.icash_live_conversations other where other.account_id=r.account_id and other.operation_key=r.operation_key
    and nullif(other.conversation_id,'') is not null)
   and exists(select 1 from public.icash_recorded_gate_terminal_receipts g where g.recording_id=r.id
    and g.account_id=r.account_id and g.call_sid=r.call_sid and g.created_at between r.dial_claimed_at and finish
    and g.receipt->>'sid'=r.call_sid and g.receipt->>'account_sid'=r.provider_account_sid
    and g.receipt->>'from'=r.from_phone and g.receipt->>'to'=r.to_phone and g.receipt->>'direction'='outbound-api'
    and g.receipt->>'duration'='0' and g.receipt->>'status' in ('busy','no-answer','failed','canceled')) carrier_unanswered$new$);
 anchor:=$old$'humanResponseUnknown',count(*) filter(where not coalesce(completed,false))$old$;
 if length(patched)-length(replace(patched,anchor,''))<>length(anchor) then raise exception 'Expected unique public.icash_seller_conversion_report(uuid,integer) source anchor';end if;
 patched:=replace(patched,anchor,$new$'carrierUnanswered',count(*) filter(where not coalesce(completed,false) and carrier_unanswered),
   'humanResponseUnknown',count(*) filter(where not coalesce(completed,false) and not carrier_unanswered)$new$);
 execute patched;
 if pg_get_functiondef(target)<>patched then raise exception 'Unexpected public.icash_seller_conversion_report(uuid,integer) readback';end if;
end $patch$;
