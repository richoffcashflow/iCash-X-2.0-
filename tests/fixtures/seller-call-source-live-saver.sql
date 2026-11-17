CREATE OR REPLACE FUNCTION public.icash_save_live_result(p_call uuid, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_live_conversations; prop text; due timestamptz; zone text;memory_binding jsonb;memory_phone text;
begin
 select * into strict c from public.icash_live_conversations where id=p_call;
 if c.party='seller' and public.icash_seller_memory_enabled(c.account_id) then
  memory_binding:=jsonb_build_array(c.account_id,c.screening_id,c.contact_key);
  select min(phone) into memory_phone from (
   select t.recipient phone from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where t.account_id=c.account_id and d.screening_id=c.screening_id and t.party='seller' and t.retired_at is null and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=c.contact_key
   union select p.phone from public.icash_contact_permissions p where p.account_id=c.account_id and p.screening_id=c.screening_id and p.party='seller' and encode(sha256(convert_to(p.phone,'UTF8')),'hex')=c.contact_key
  ) phones having count(distinct phone)=1;
  if memory_phone is not null then perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));end if;
 end if;
 select * into strict c from public.icash_live_conversations where id=p_call for update;
 if memory_binding is not null and memory_binding is distinct from jsonb_build_array(c.account_id,c.screening_id,c.contact_key) then raise exception 'Seller call source binding changed';end if;
 if c.state='complete' then if c.result<>p_result then raise exception 'Conflicting result';end if;return;end if;
 if octet_length(p_result::text)>262144 or jsonb_typeof(p_result->'transcript') is distinct from 'array' or nullif(p_result->>'summary','') is null or p_result->>'party' is distinct from c.party then raise exception 'Invalid result';end if;
 select snapshot->>'propertyId' into strict prop from public.icash_screening_jobs where id=c.screening_id and account_id=c.account_id;
 if exists(select 1 from public.icash_inbound_voice_receipts where live_call_id=c.id) then
  perform public.icash_open_handoff(c.id,'Incoming caller details need verification',left(p_result->>'summary',6000),'Confirm the caller and property before using saved deal terms.');
 end if;
 if (p_result->>'humanRequested')::boolean then perform public.icash_open_handoff(c.id,'Requested a person',left(p_result->>'summary',6000),p_result->>'nextAction');end if;
 update public.icash_handoffs set summary=left(p_result->>'summary',6000) where conversation_id=c.id;
 if (case when c.party='seller' then public.icash_seller_call_disposition(p_result)='opt_out' else coalesce((p_result->>'optedOut')::boolean,false) end) then
  insert into public.icash_contact_suppressions(account_id,contact_key,source_conversation) values(c.account_id,c.contact_key,c.id) on conflict do nothing;
  insert into public.icash_property_controls(account_id,property_id,manual) values(c.account_id,prop,true) on conflict(account_id,property_id) do update set manual=true,updated_at=now();
  update public.icash_live_callbacks b set state='canceled' from public.icash_live_conversations v where b.conversation_id=v.id and v.account_id=c.account_id and v.contact_key=c.contact_key and b.state in ('pending_dispatch_review','held_for_human');
 elsif p_result->>'callbackDueAt' is not null then
  due:=(p_result->>'callbackDueAt')::timestamptz;zone:=p_result->>'callbackTimezone';
  if not exists(select 1 from public.icash_timezone_names where name=zone) or due>now()+interval '90 days' then raise exception 'Invalid callback time';end if;
  insert into public.icash_live_callbacks(conversation_id,account_id,screening_id,due_at,timezone,evidence,state)
  values(c.id,c.account_id,c.screening_id,due,zone,jsonb_build_object('quote',p_result->'callbackQuote','readback',p_result->'callbackEvidence'),case when due<=now() then 'missed' when exists(select 1 from public.icash_property_controls where account_id=c.account_id and property_id=prop and manual) then 'held_for_human' else 'pending_dispatch_review' end) on conflict(conversation_id) do update set due_at=excluded.due_at,timezone=excluded.timezone,evidence=excluded.evidence,state=excluded.state where icash_live_callbacks.state in ('pending_dispatch_review','held_for_human');
 else
  -- A tool request is provisional until the provider transcript verifies it.
  update public.icash_live_callbacks set state='canceled' where conversation_id=c.id and state in ('pending_dispatch_review','held_for_human');
 end if;
 update public.icash_live_conversations set result=p_result,state='complete',completed_at=now(),tool_token_hash=null where id=c.id;
end $function$
