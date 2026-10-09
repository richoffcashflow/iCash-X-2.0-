begin;
set local lock_timeout='3s';

-- Keep independent requests from the same conversation visible together.
alter table public.icash_buyer_viewing_requests add column viewing_quote text check(length(viewing_quote) between 1 and 4000);
alter table public.icash_buyer_viewing_requests add column coordination_quote text check(length(coordination_quote) between 1 and 4000);
alter table public.icash_buyer_viewing_requests drop constraint icash_buyer_viewing_requests_kind_check;
alter table public.icash_buyer_viewing_requests add constraint icash_buyer_viewing_requests_kind_check check(kind in ('viewing','reservation','payment_reported','title_company','buyer_followup'));

create or replace function public.icash_buyer_purchase_intent(p_turns jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;b text;intent jsonb;payment jsonb;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  if turn->>'role' is distinct from 'user' then continue;end if;b:=btrim(turn->>'message');
  if length(b) not between 1 and 1500 then continue;end if;
  if b ~* '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$' or b ~* '\m(stop contacting|do not contact|don''t contact|remove me)\M' then intent:=null;payment:=null;
  elsif b ~* '\m(i|we) (did not|didn''t|have not|haven''t|never) (pay|paid|send|sent|wire|wired)\M' then payment:=null;
  elsif b ~* '\m(i|we) (have |already |just )*(paid|sent|wired|zell[ae]d)\M'
   and (b ~* '\m(deposit|emd|money|payment|funds|cash ?app|zelle|wire)\M' or b ~ '\$[0-9]') then payment:=jsonb_build_object('kind','payment_reported','quote',b);
  elsif b ~* '\m(not ready (to|for)|(don''t|do not|don''t want to|do not want to|won''t|cannot|can''t) (send|text|email|pay|sign|buy)|(don''t want|do not want|cancel|withdraw)( the| an?| my)? (agreement|assignment|contract|deposit|reservation))\M' then intent:=null;
  elsif b !~* '\m(if|unless|provided)\M' and (b ~* '\m(ready to|want to|would like to|can i|how (can|do) i) (pay|send|wire|reserve|buy|sign)\M'
   or b ~* '\m(send|text|email|want|need|request|ready for|like)\M.*\m(assignment|agreement|contract|payment instructions)\M')
   then intent:=jsonb_build_object('kind','reservation','quote',b);
  end if;
 end loop;
 -- A subsequent agreement request must not hide a claimed payment.
 return coalesce(payment,intent);
end $$;

create or replace function public.icash_buyer_title_quote(p_turns jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;answer text;previous text:='';experience text;quote text;unrelated boolean;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  answer:=btrim(turn->>'message');
  if turn->>'role'='user' and length(answer) between 1 and 1500 then
   unrelated:=answer ~* '^(what|when|where|how|who|can|could|would|is|are|do|does)\M' or answer ~ '[?]$'
    or answer ~* '\m(don''t know|do not know|don''t remember|do not remember|can''t remember|cannot remember|forgot|not sure|no preference)\M'
    or answer ~* '^(no|nope|none|not yet|thanks|thank you|okay|ok)[.! ]*$';
   if answer ~* '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$' then quote:=null;experience:=null;
   elsif answer ~* '\m(don''t|do not|no longer|not) (use|recommend|have|want)\M' and answer ~* '\m(title|escrow|company|closer)\M' then quote:=null;
   else
    if previous ~* '\m(have|ever|previously)\M.*\m(wholesaler|assignment deal)\M' and answer ~* '^(yes|yeah|yep|no|nope|i have|we have|i haven''t|i have not|this is my first)\M' then experience:=answer;end if;
    if not unrelated and (
     answer ~* '\m(my|our|use|used|prefer|recommend|work with|worked with)\M.*\m(title|escrow)\M'
     or answer ~* '\m(title|escrow)\M.*\m(used|prefer|recommend|worked with)\M'
     or previous ~* '\m(which|what|name|who|share)\M.*\m(title company|title office|escrow company)\M' and answer !~* '\m(property|view|viewing|visit|deposit|payment|agreement|price|closing date)\M'
    ) then quote:=left(case when experience=answer then answer else concat_ws(E'\n',experience,answer) end,4000);
    elsif quote is not null and not unrelated and answer !~* '\m(property|view|viewing|visit|deposit|payment|agreement|price)\M'
     and previous ~* '\m(contact|closer|escrow officer|phone|email)\M' then quote:=left(quote||E'\n'||answer,4000);
    end if;
   end if;
  end if;
  if turn->>'role'='agent' then previous:=answer;end if;
 end loop;
 return quote;
end $$;

-- Requests outside a routine quote stay visible for a person to resolve.
-- Only exact buyer statements enter the note; they never change deal terms.
create function public.icash_buyer_coordination_quote(p_turns jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;b text;quote text;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  if turn->>'role' is distinct from 'user' then continue;end if;b:=btrim(turn->>'message');
  if length(b) not between 1 and 1500 then continue;end if;
  if b ~* '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$' then quote:=null;
  elsif b ~* '\m(refund|refundable|dispute|chargeback|human|real person|manager|photos?|pictures?|inspection|inspect|financing|finance|loan|counteroffer)\M'
   or b ~* '\m(offer|pay|take|accept|price)\M.*(\$[0-9]|[0-9][0-9,]* (dollars|thousand)|lower|less|reduce)'
   or b ~* '\m(close|closing)\M.*\m(later|earlier|extend|extension|change|instead|november|december|january|february|march|april|may|june|july|august|september|october)\M'
   or b ~* '\m(cancel|withdraw|no longer|do not want|don''t want)\M.*\m(title|company|agreement|assignment|contract|reservation)\M'
   or b ~* '\m(call me|call back|callback|speak to|talk to)\M'
   then quote:=left(concat_ws(E'\n',quote,b),4000);
  end if;
 end loop;
 return quote;
end $$;

alter function public.icash_save_buyer_inbound_history(uuid,text,jsonb) rename to icash_save_buyer_history_before_scenario_audit;
create function public.icash_save_buyer_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b icash_recorded_reception_private.buyer_bindings;t public.icash_text_threads;screen uuid;viewing text;coordination text;
begin
 -- Preserve the existing completed-call, phone, account, and immutable replay gates.
 if not public.icash_save_buyer_history_before_scenario_audit(p_session,p_conversation,p_transcript) then return false;end if;
 viewing:=public.icash_buyer_viewing_quote(p_transcript);coordination:=public.icash_buyer_coordination_quote(p_transcript);
 if viewing is null and coordination is null then return true;end if;
 select * into b from icash_recorded_reception_private.buyer_bindings where session_id=p_session;
 select * into t from public.icash_text_threads where id=b.thread_id and account_id=b.account_id and deal_id=b.deal_id and party='buyer';
 select screening_id into screen from public.icash_deal_files where id=b.deal_id and account_id=b.account_id;
 if t.id is null or screen is null then return false;end if;
 insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,viewing_quote,coordination_quote,timezone,kind)
 values(b.account_id,b.deal_id,screen,t.id,'call',p_session,coalesce(viewing,coordination),viewing,coordination,t.timezone,case when viewing is null then 'buyer_followup' else 'viewing' end)
 on conflict(source,source_id) do update set viewing_quote=excluded.viewing_quote,coordination_quote=excluded.coordination_quote
 where icash_buyer_viewing_requests.state='needs_confirmation';
 return true;
end $$;

create function public.icash_capture_buyer_scenario_text() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;screen uuid;previous text;turns jsonb;viewing text;coordination text;intent jsonb;
begin
 if new.direction<>'incoming' or new.state<>'received' then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party='buyer' and retired_at is null;
 if not found or public.icash_buyer_package_data(t.account_id,t.deal_id) is null then return new;end if;
 select screening_id into screen from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;if screen is null then return new;end if;
 select body into previous from public.icash_text_messages where account_id=t.account_id and thread_id=t.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at<=new.created_at order by created_at desc,id desc limit 1;
 turns:=jsonb_build_array(jsonb_build_object('role','agent','message',coalesce(previous,'')),jsonb_build_object('role','user','message',new.body));
 viewing:=public.icash_buyer_viewing_quote(turns);coordination:=public.icash_buyer_coordination_quote(turns);intent:=public.icash_buyer_purchase_intent(turns);
 if viewing is null and coordination is null and intent is null then return new;end if;
 insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,viewing_quote,coordination_quote,timezone,kind)
 values(t.account_id,t.deal_id,screen,t.id,'text',new.id,coalesce(intent->>'quote',viewing,coordination),viewing,coordination,t.timezone,coalesce(intent->>'kind',case when viewing is null then 'buyer_followup' else 'viewing' end))
 on conflict(source,source_id) do update set viewing_quote=excluded.viewing_quote,coordination_quote=excluded.coordination_quote,
  kind=case when intent is null then icash_buyer_viewing_requests.kind else excluded.kind end,
  quote=case when intent is null then icash_buyer_viewing_requests.quote else excluded.quote end
 where icash_buyer_viewing_requests.state='needs_confirmation';
 return new;
end $$;
create trigger zzz_buyer_scenario_text after insert or update of thread_id,state on public.icash_text_messages for each row execute function public.icash_capture_buyer_scenario_text();
-- A received message can be linked to its thread after initial insertion.
drop trigger buyer_title_text on public.icash_text_messages;
create trigger buyer_title_text after insert or update of thread_id,state on public.icash_text_messages for each row execute function public.icash_capture_buyer_title_text();

create or replace function public.icash_buyer_reception_calls(p_account uuid,p_screenings uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item||jsonb_build_object('summary',case request.kind
  when 'reservation' then 'Buyer requested the assignment agreement or deposit instructions. Review all saved requests; viewing is optional.'
  when 'payment_reported' then 'Buyer reported a payment. Receipt needs verification; this report does not reserve the property.'
  when 'title_company' then 'Buyer supplied a title-company preference for review. Title has not been selected by this request.'
  when 'buyer_followup' then 'Buyer requested team follow-up. Review the exact buyer statements before replying.'
  else item->>'summary' end) order by item->>'completed_at' desc),'[]')
 from jsonb_array_elements(public.icash_buyer_calls_before_purchase_intent(p_account,p_screenings)) item
 left join public.icash_buyer_viewing_requests request on request.account_id=p_account and request.source='call' and request.source_id=(item->>'id')::uuid
$$;

-- A new topic must not be consumed as a title company/contact answer.
create or replace function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;package jsonb;b text;previous text;title_quote text;unrelated boolean;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';
 if not found or p_incoming is null or length(p_incoming)>1500 then return null;end if;
 package:=public.icash_buyer_package_data(p_account,t.deal_id);if package is null then return null;end if;
 if package->'reserved'='true'::jsonb then return public.icash_buyer_reply_before_title_preference(p_account,p_thread,p_incoming);end if;
 b:=lower(btrim(regexp_replace(p_incoming,'[?!.]+\s*$','','g')));
 if b ~ '\m(stop|unsubscribe|cancel|not interested|no thanks|human|person)\M' then return null;end if;
 title_quote:=public.icash_buyer_title_quote(jsonb_build_array(jsonb_build_object('role','user','message',p_incoming)));
 if title_quote is not null or b ~ '^(which|what|who|has|is|can|could|do|does)\M.*\m(title company|title office|escrow company)\M' then
  if package->>'titleSelectionStatus'='needs_confirmation' then return 'The title contact needs confirmation. The team can review your local title-company preference before choosing or changing the closer.';end if;
  if package->>'titleSelectionStatus'='selected' then return 'A title contact is already selected for this deal. The team can review your preferred local title company before making any change.';end if;
  if title_quote is not null then
   if b ~ '@|[0-9]{3}[^a-z]*[0-9]{3}[^a-z]*[0-9]{4}' then return 'Those title-company and contact details are available for team review. The company still needs confirmation for this assignment; it has not been selected or contacted through this conversation.';end if;
   return 'Your local title-company preference is available for team review. Who is the escrow contact there? The company still needs confirmation for this assignment.';
  end if;
  return 'The title company has not been selected yet. Have you closed an assignment deal with a wholesaler before?';
 end if;
 select body into previous from public.icash_text_messages where account_id=p_account and thread_id=p_thread and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at>now()-interval '1 day' order by created_at desc,id desc limit 1;
 unrelated:=b ~ '^(what|when|where|how|who|can|could|would|is|are|do|does)\M' or p_incoming ~ '[?]\s*$'
  or b ~ '\m(property|view|viewing|visit|deposit|payment|agreement|contract|price|photos?|pictures?|refund|closing date)\M';
 if package->>'titleSelectionStatus'='not_selected' and not unrelated then
  if previous ~* 'Have you closed an assignment deal with a wholesaler' then
   if b ~ '^(yes|yeah|yep|i have|we have)([ ,.!]|$)' then return 'Which local title company did you use?';end if;
   if b ~ '^(no|nope|not yet|i have not|i haven''t|this is my first)([ ,.!]|$)' then return 'That is okay. The team can coordinate title for your first assignment purchase.';end if;
  elsif previous ~* '\m(title company|escrow contact|phone number or email)\M' and b ~ '\m(don''t know|do not know|don''t remember|do not remember|can''t remember|cannot remember|forgot|not sure|no preference)\M|^(no|none|not yet)$' then
   return 'That is okay. The team can coordinate title. You can provide those details later if you have them.';
  elsif previous='Which local title company did you use?' and length(b)>2 then
   return 'The team can confirm whether that company handles assignments and this property. Who is your escrow contact there?';
  elsif previous ~* 'Who is (your|the) escrow contact' and b !~ '@|[0-9]{3}[^a-z]*[0-9]{3}[^a-z]*[0-9]{4}' then
   return 'What is the escrow contact''s phone number or email?';
  elsif previous ~* 'Who is (your|the) escrow contact|What is the escrow contact''s phone number or email' then
   return 'Those details are available for team review. A title company has not been selected or contacted through this conversation.';
  end if;
 end if;
 return public.icash_buyer_reply_before_title_preference(p_account,p_thread,p_incoming);
end $$;

revoke all on function public.icash_buyer_coordination_quote(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_save_buyer_history_before_scenario_audit(uuid,text,jsonb),public.icash_capture_buyer_scenario_text() from public,anon,authenticated;
revoke all on function public.icash_save_buyer_history_before_scenario_audit(uuid,text,jsonb),public.icash_capture_buyer_scenario_text() from service_role;
grant execute on function public.icash_buyer_coordination_quote(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb) to service_role;
commit;
