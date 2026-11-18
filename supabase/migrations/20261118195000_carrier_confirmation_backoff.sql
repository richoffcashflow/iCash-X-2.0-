-- Back off repeat reads of an authenticated original explicitly awaiting carrier confirmation.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare target regprocedure:='public.icash_finish_text_delivery_recheck(uuid,jsonb)'::regprocedure; source text; anchor text; patched text;
begin
 source:=pg_get_functiondef(target);
 if md5(source)<>'effbe517fd96df71e3c0d27107da1a7f' or not exists(select 1 from pg_proc where oid=target
  and proowner='postgres'::regrole and proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  and not prosecdef and provolatile='v' and proconfig=array['search_path=""','statement_timeout=5s']) then raise exception 'Unexpected public.icash_finish_text_delivery_recheck(uuid,jsonb) predecessor or authority';end if;
 patched:=source;
 anchor:=$old$     if expected_event is not null and provider_stamp between o.dispatched_at-interval '5 minutes' and job.created_at+interval '5 seconds'$old$;
 if length(patched)-length(replace(patched,anchor,''))<>length(anchor) then raise exception 'Expected unique public.icash_finish_text_delivery_recheck(uuid,jsonb) source anchor';end if;
 patched:=replace(patched,anchor,$new$     -- An exact authenticated timeline with handoff but no terminal event is pending.
     -- Leave immediate webhooks and any genuine terminal GET on their existing path.
     if provider_stamp between o.dispatched_at-interval '5 minutes' and job.created_at+interval '5 seconds'
      and d->>'status' in ('sent','delivered','pending')
      and not exists(select 1 from jsonb_array_elements(d->'tracking') x where x->>'event' in ('text.delivery.confirmed','text.delivery.failed','text.cancelled'))
      and exists(select 1 from jsonb_array_elements(d->'tracking') handoff
       join jsonb_array_elements(d->'tracking') waiting on waiting->>'event'='delivery.awaiting_confirmation'
       where handoff->>'event'='carrier.handed_off'
        and (handoff->>'timestamp')::timestamptz between provider_stamp-interval '5 seconds' and job.created_at+interval '5 seconds'
        and (waiting->>'timestamp')::timestamptz between (handoff->>'timestamp')::timestamptz and job.created_at+interval '5 seconds') then
      update icash_text_receipt_private.schedule set next_check_at=greatest(next_check_at,now()+interval '4 hours')
       where message_id=m.id and attempts>=2;
     end if;
     if expected_event is not null and provider_stamp between o.dispatched_at-interval '5 minutes' and job.created_at+interval '5 seconds'$new$);
 execute patched;
 if pg_get_functiondef(target)<>patched then raise exception 'Unexpected public.icash_finish_text_delivery_recheck(uuid,jsonb) readback';end if;
end $patch$;
