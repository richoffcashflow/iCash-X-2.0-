begin;
set local lock_timeout='3s';
-- A buyer can request seller availability without providing a date/time.
-- Preserve exact caller evidence, cancellations and replay behavior.
create or replace function public.icash_buyer_viewing_quote(p_transcript jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare t jsonb;previous text:='';request text;answer text;
begin
 if jsonb_typeof(p_transcript) is distinct from 'array' then return null;end if;
 for t in select value from jsonb_array_elements(p_transcript) loop
  answer:=btrim(t->>'message');
  if t->>'role'='user' and length(answer) between 1 and 1500 then
   if answer ~* '\m(no|not|never|don''t|do not|cancel|cannot|can''t)\M' then
    if answer ~* '\m(see|view|visit|tour|showing|interested|cancel)\M' or lower(answer) ~ '^no[.! ]*$' then request:=null;
    elsif request is not null and previous ~* '\m(day|time|when|timezone|date)\M' then request:=left(request||E'\n'||answer,4000);end if;
   elsif answer ~* '\m(see|view|visit|tour|showing|walk through)\M' and answer ~* '\m(property|house|home|it|this|showing|tour|walk through)\M'
    or answer ~* '^(what (times|days|viewing times) are available|when (can i|is it possible to) (see|view|visit) (the property|it))[?!. ]*$'
    or (previous ~* '\m(see|view|visit|tour|showing)\M' and previous ~* '\m(when|day|time|like|want|schedule)\M' and answer !~* '^(thanks|thank you|okay|ok)[.! ]*$') then
    request:=case when request is null then answer else left(request||E'\n'||answer,4000) end;
   elsif request is not null and previous ~* '\m(day|time|when|timezone|date)\M' then
    request:=left(request||E'\n'||answer,4000);
   end if;
  end if;
  if t->>'role'='agent' then previous:=answer;end if;
 end loop;
 return request;
end $$;

-- Change only the no-slot viewing reply. Existing price, payment, reservation,
-- contact permission and dispatch checks remain in their current functions.
alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_reply_before_seller_followup;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare reply text;package jsonb;deal uuid;
begin
 reply:=public.icash_buyer_reply_before_seller_followup(p_account,p_thread,p_incoming);
 if reply is null or reply not in (
  'We can coordinate a viewing. What date, time with AM/PM, and timezone work for you? Access still needs seller confirmation. Viewing is optional.',
  'We can help coordinate a viewing. What day, time and timezone work for you? The visit needs seller or occupant confirmation.',
  'Your viewing request is saved for coordination. Seller or occupant confirmation is still needed before the visit is booked.'
 ) then return reply;end if;
 select deal_id into deal from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';
 if not found then return null;end if;
 package:=public.icash_buyer_package_data(p_account,deal);
 if package is null then return null;end if;
 if package->'reserved'='true'::jsonb or jsonb_array_length(coalesce(package->'viewingSlots','[]'))>0 then return reply;end if;
 return 'We''ll check with the seller and get back to you with available viewing times. Your visit isn''t booked yet. Viewing is optional.';
end $$;
revoke all on function public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_reply_before_seller_followup(uuid,uuid,text),public.icash_buyer_viewing_quote(jsonb) from public,anon,authenticated;
grant execute on function public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_reply_before_seller_followup(uuid,uuid,text),public.icash_buyer_viewing_quote(jsonb) to service_role;
commit;
