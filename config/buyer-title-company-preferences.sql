begin;
set local lock_timeout='3s';
-- Title selection is current deal data, never inferred from a buyer's suggestion.
alter function public.icash_buyer_package_data(uuid,uuid) rename to icash_buyer_package_before_title_preference;
create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare package jsonb;
begin
 package:=public.icash_buyer_package_before_title_preference(p_account,p_deal);
 if package is null then return null;end if;
 return package||jsonb_build_object('titleSelectionStatus',case when exists(
  select 1 from public.icash_title_contacts c join public.icash_deal_files d on d.id=c.deal_id and d.account_id=c.account_id
  where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now() and lower(c.email)=lower(d.terms->>'titleEmail')
 ) then 'selected' when exists(select 1 from public.icash_deal_files d where d.id=p_deal and d.account_id=p_account and (nullif(btrim(d.terms->>'titleEmail'),'') is not null or nullif(btrim(d.terms->>'escrowAgent'),'') is not null)) then 'needs_confirmation' else 'not_selected' end);
end $$;

alter table public.icash_buyer_viewing_requests add column title_quote text check(length(title_quote) between 1 and 4000);
alter table public.icash_buyer_viewing_requests drop constraint icash_buyer_viewing_requests_kind_check;
alter table public.icash_buyer_viewing_requests add constraint icash_buyer_viewing_requests_kind_check check(kind in ('viewing','reservation','payment_reported','title_company'));

-- Exact buyer statements only. Company/contact details remain unverified notes.
create function public.icash_buyer_title_quote(p_turns jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;answer text;previous text:='';experience text;quote text;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  answer:=btrim(turn->>'message');
  if turn->>'role'='user' and length(answer) between 1 and 1500 then
   if answer ~* '\m(stop|unsubscribe|not interested|no thanks)\M' then quote:=null;experience:=null;
   elsif answer ~* '\m(don''t|do not|no longer|not) (use|recommend|have|want)\M' and answer ~* '\m(title|escrow|company|closer)\M' then quote:=null;
   elsif previous ~* '\m(have|ever|previously)\M.*\m(wholesaler|assignment deal)\M' then experience:=answer;
   elsif answer !~* '^(no|nope|none|not yet|thanks|thank you|okay|ok)[.! ]*$' and answer !~ '[?]$' and (
    answer ~* '\m(my|our|use|used|prefer|recommend|work with|worked with)\M.*\m(title|escrow)\M'
    or answer ~* '\m(title|escrow)\M.*\m(used|prefer|recommend|worked with)\M'
    or previous ~* '\m(which|what|name|who|share)\M.*\m(title company|title office|escrow company)\M'
   ) then quote:=left(concat_ws(E'\n',experience,answer),4000);
   elsif quote is not null and answer !~* '\m(property|view|viewing|visit|deposit|payment|agreement)\M' and previous ~* '\m(contact|closer|escrow officer|phone|email)\M'
    and answer !~* '^(no|nope|none|not yet|thanks|thank you|okay|ok)[.! ]*$' then quote:=left(quote||E'\n'||answer,4000);
   end if;
  end if;
  if turn->>'role'='agent' then previous:=answer;end if;
 end loop;
 return quote;
end $$;

alter function public.icash_save_buyer_inbound_history(uuid,text,jsonb) rename to icash_save_buyer_history_before_title_preference;
create function public.icash_save_buyer_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b icash_recorded_reception_private.buyer_bindings;t public.icash_text_threads;screen uuid;quote text;
begin
 -- The existing writer verifies completed call identity and immutable history.
 if not public.icash_save_buyer_history_before_title_preference(p_session,p_conversation,p_transcript) then return false;end if;
 quote:=public.icash_buyer_title_quote(p_transcript);if quote is null then return true;end if;
 select * into b from icash_recorded_reception_private.buyer_bindings where session_id=p_session;
 select * into t from public.icash_text_threads where id=b.thread_id and account_id=b.account_id and deal_id=b.deal_id and party='buyer';
 select screening_id into screen from public.icash_deal_files where id=b.deal_id and account_id=b.account_id;
 if t.id is null or screen is null then return false;end if;
 insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,title_quote,timezone,kind)
 values(b.account_id,b.deal_id,screen,t.id,'call',p_session,quote,quote,t.timezone,'title_company')
 on conflict(source,source_id) do update set title_quote=excluded.title_quote
 where icash_buyer_viewing_requests.state='needs_confirmation' and icash_buyer_viewing_requests.title_quote is null;
 return true;
end $$;

create function public.icash_capture_buyer_title_text() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;turns jsonb;quote text;screen uuid;
begin
 if new.direction<>'incoming' or new.state<>'received' then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party='buyer';if not found then return new;end if;
 select screening_id into screen from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;if screen is null then return new;end if;
 select jsonb_agg(jsonb_build_object('role',case when direction='incoming' then 'user' else 'agent' end,'message',body) order by created_at,id) into turns
 from (select id,direction,body,created_at from public.icash_text_messages
  where thread_id=t.id and account_id=t.account_id and created_at between new.created_at-interval '1 day' and new.created_at
  and (id=new.id or direction='incoming' and state='received' or direction='outgoing' and state in ('accepted','delivered') and provider_id is not null)
  order by created_at desc,id desc limit 12) messages;
 quote:=public.icash_buyer_title_quote(turns);
 if quote is null or position(btrim(new.body) in quote)=0 then return new;end if;
 insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,title_quote,timezone,kind)
 values(t.account_id,t.deal_id,screen,t.id,'text',new.id,quote,quote,t.timezone,'title_company')
 on conflict(source,source_id) do update set title_quote=excluded.title_quote
 where icash_buyer_viewing_requests.state='needs_confirmation' and icash_buyer_viewing_requests.title_quote is null;
 return new;
end $$;
create trigger buyer_title_text after insert or update of state on public.icash_text_messages for each row execute function public.icash_capture_buyer_title_text();

alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_reply_before_title_preference;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;package jsonb;b text;previous text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';
 if not found or length(p_incoming)>1500 then return null;end if;
 package:=public.icash_buyer_package_data(p_account,t.deal_id);if package is null then return null;end if;
 if package->'reserved'='true'::jsonb then return public.icash_buyer_reply_before_title_preference(p_account,p_thread,p_incoming);end if;
 b:=lower(btrim(regexp_replace(p_incoming,'[?!.]+\s*$','','g')));
 if b ~ '\m(stop|unsubscribe|cancel|not interested|no thanks|human|person)\M' then return public.icash_buyer_reply_before_title_preference(p_account,p_thread,p_incoming);end if;
 if b ~ '\m(title company|title office|escrow company)\M' and b ~ '\m(which|what|who|decided|selected|use|using|used|prefer|recommend)\M' then
  if package->>'titleSelectionStatus'='needs_confirmation' then return 'The title contact needs confirmation. The team can review your local title-company preference before choosing or changing the closer.';end if;
  if package->>'titleSelectionStatus'='selected' then return 'A title contact is already selected for this deal. The team can review your preferred local title company before making any change.';end if;
  if public.icash_buyer_title_quote(jsonb_build_array(jsonb_build_object('role','user','message',p_incoming))) is not null then
   return 'We can work with your local title company once the team confirms it handles assignments and this property. Have you closed an assignment deal with a wholesaler through them before?';
  end if;
  return 'The title company has not been selected yet. Have you closed an assignment deal with a wholesaler before?';
 end if;
 select body into previous from public.icash_text_messages where account_id=p_account and thread_id=p_thread and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at>now()-interval '1 day' order by created_at desc,id desc limit 1;
 if package->>'titleSelectionStatus'='not_selected' and previous ~* 'Have you closed an assignment deal with a wholesaler' then
  if b ~ '^(yes|yeah|yep|i have|we have)([ ,.!]|$)' then return 'Which local title company did you use?';end if;
  if b ~ '^(no|nope|not yet|i have not|i haven''t)([ ,.!]|$)' then return 'That is okay. The team can coordinate title for your first assignment purchase.';end if;
 elsif previous='Which local title company did you use?' and length(b)>2 and b !~ '^(no|none|not yet)([ ,.!]|$)' then
  return 'The team can confirm whether that company handles assignments and this property. Who is your escrow contact there?';
 elsif previous ~ '^The team can confirm whether that company handles assignments' and b !~ '@|[0-9]{7}' then
  return 'What is the escrow contact''s phone number or email?';
 elsif previous in ('What is the escrow contact''s phone number or email?','The team can confirm whether that company handles assignments and this property. Who is your escrow contact there?') then
  return 'Those details are saved for the team to confirm. A title company has not been selected or contacted through this conversation.';
 end if;
 return public.icash_buyer_reply_before_title_preference(p_account,p_thread,p_incoming);
end $$;

revoke all on function public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_title_preference(uuid,uuid),public.icash_buyer_title_quote(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_save_buyer_history_before_title_preference(uuid,text,jsonb),public.icash_capture_buyer_title_text(),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_reply_before_title_preference(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.icash_save_buyer_history_before_title_preference(uuid,text,jsonb),public.icash_capture_buyer_title_text() from service_role;
grant execute on function public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_title_preference(uuid,uuid),public.icash_buyer_title_quote(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_reply_before_title_preference(uuid,uuid,text) to service_role;
commit;
