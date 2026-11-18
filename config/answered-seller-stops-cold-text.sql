-- An inbound reply during a call already ends unanswered follow-up, even when the
-- completed call is ingested later. The conversational reply keeps its own final checks.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare target regprocedure:='public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure;
 source text;patched text;
 reply_check constant text:=$old$  -- A reply exits cold pursuit even if it was on a different property/account.
  if exists(select 1 from public.icash_text_threads other
   join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
   where other.recipient=t.recipient and other.party='seller' and m.direction='incoming'
    and m.state='received' and (m.provider_id is not null or m.event_id is not null))
   or exists(select 1 from public.icash_live_conversations c where c.contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')
    and c.party='seller' and c.state='complete' and (public.icash_call_has_seller_response(c.result) or public.icash_seller_call_disposition(c.result) is not null))
   then return false;end if;
$old$;
 anchor constant text:=$anchor$ -- Requested-contact flows keep their separately verified source-bound sequence.$anchor$;
begin
 source:=pg_get_functiondef(target);
 if md5(source)<>'8828d5de8016615c0eb5e3d37ef700c8' or not exists(select 1 from pg_proc where oid=target
  and proowner='postgres'::regrole and not prosecdef and provolatile='s' and proconfig=array['search_path=""']
  and proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or length(source)-length(replace(source,reply_check,''))<>length(reply_check)
  or length(source)-length(replace(source,anchor,''))<>length(anchor) then
  raise exception 'Seller follow-up cadence predecessor or authority changed';
 end if;
 patched:=replace(source,reply_check,'');
 patched:=replace(patched,anchor,E' if p_followup then\n'||reply_check||E' end if;\n'||anchor);
 execute patched;
 if pg_get_functiondef(target)<>patched then raise exception 'Seller follow-up cadence readback changed';end if;
end $patch$;
