begin;
set local lock_timeout='3s';

-- Keep viewing evidence tied to the viewing request. A declined day or a new
-- title/agreement question is not a cancellation or acceptance of a viewing.
create or replace function public.icash_buyer_viewing_quote(p_transcript jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;previous text:='';request text;answer text;b text;clause text;decision boolean;view_question boolean;time_answer boolean;other_topic boolean;
begin
 if jsonb_typeof(p_transcript) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_transcript) loop
  answer:=btrim(turn->>'message');
  if turn->>'role'='user' and length(answer) between 1 and 1500 then
   b:=lower(replace(answer,'’',''''));
   if b ~ '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$'
    or b ~ '\m(stop contacting|do not contact|don''t contact|remove me)\M' then request:=null;continue;end if;
   decision:=null;
   -- Evaluate separate clauses in their spoken order, while storing the exact
   -- complete buyer turn so a rejected day and alternative remain together.
   for clause in select btrim(value) from regexp_split_to_table(b,'[.!?;]+|\m(but|however)\M') value loop
    if clause ~ '\m(cancel|withdraw|skip)\M.*\m(viewing|showing|visit|tour|walk through)\M'
     or clause ~ '\m(no|not) (viewing|showing|visit|tour)\M'
     or clause ~ '\m(no need|not interested|not planning) (in |on |to )?(seeing|viewing|visiting|touring|see|view|visit|tour)\M'
     or clause ~ '\m(don''t|do not|never|won''t|will not|cannot|can''t)( (want|need|plan|wish|intend) to| to)? (see|view|visit|tour|walk through)\M'
     or clause ~ '\m(don''t|do not|never|won''t|will not) (want|need)( a| the)? (viewing|showing|visit|tour)\M'
     then decision:=false;
    elsif clause ~ '^do i (have|need) to (see|view|visit)\M' or clause ~ '^can i (skip|buy without)\M' then continue;
    elsif clause ~ '\m(see|view|viewing|visit|tour|showing|walk through)\M' and clause ~ '\m(property|house|home|it|this|viewing|showing|tour|walk through)\M'
     or clause ~ '^(what (times|days|viewing times) are available|when (can i|is it possible to) (see|view|visit) (the property|it))$'
     then decision:=true;
    end if;
   end loop;
   view_question:=previous ~* '\m(see|view|viewing|visit|tour|showing)\M' and previous ~* '\m(when|day|time|like|want|schedule)\M';
   other_topic:=b ~ '\m(assignment|agreement|contract|title|escrow|deposit|payment|price|photos?|pictures?|refund|human|person|manager|call me|call back|callback|speak to|talk to)\M';
   time_answer:=not other_topic and b ~ '\m(am|pm|morning|afternoon|evening|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|central|eastern|mountain|pacific)\M|[0-9]{1,2}:[0-9]{2}';
   if decision is false then request:=null;
   elsif decision is true
    or (view_question and not other_topic and b ~ '^(yes|yeah|yea|yep|sure|absolutely|please|that works|works for me)([,.! ]|$)')
    or (time_answer and (view_question or request is not null and previous ~* '\m(day|time|when|timezone|date)\M')) then
     request:=left(concat_ws(E'\n',request,answer),4000);
   elsif view_question and b ~ '^(no|nope|not now)[.! ]*$' then request:=null;
   end if;
  end if;
  if turn->>'role'='agent' then previous:=answer;end if;
 end loop;
 return request;
end $$;

-- Payment corrections and an agreement request are independent facts. Saying
-- "I haven't paid; send the agreement" must not discard the requested next step.
create or replace function public.icash_buyer_purchase_intent(p_turns jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;answer text;b text;intent jsonb;payment jsonb;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  if turn->>'role' is distinct from 'user' then continue;end if;answer:=btrim(turn->>'message');
  if length(answer) not between 1 and 1500 then continue;end if;
  b:=replace(answer,'’','''');
  if b ~* '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$' or b ~* '\m(stop contacting|do not contact|don''t contact|remove me)\M' then intent:=null;payment:=null;continue;end if;
  if b ~* '\m(i|we) (did not|didn''t|have not|haven''t|never) (pay|paid|send|sent|wire|wired)\M' then payment:=null;
  elsif b ~* '\m(i|we) (have |already |just )*(paid|sent|wired|zell[ae]d)\M'
   and (b ~* '\m(deposit|emd|money|payment|funds|cash ?app|zelle|wire)\M' or b ~ '\$[0-9]') then payment:=jsonb_build_object('kind','payment_reported','quote',answer);
  end if;
  if b ~* '\m(not ready (to|for)|(don''t|do not|don''t want to|do not want to|won''t|cannot|can''t) (send|text|email|pay|sign|buy)|(don''t want|do not want|cancel|withdraw)( the| an?| my)? (agreement|assignment|contract|deposit|reservation))\M' then intent:=null;
  elsif b !~* '\m(if|unless|provided)\M' and (b ~* '\m(ready to|want to|would like to|can i|how (can|do) i) (pay|send|wire|reserve|buy|sign)\M'
   or b ~* '\m(send|text|email|want|need|request|ready for|like)\M.*\m(assignment|agreement|contract|payment instructions)\M')
   then intent:=jsonb_build_object('kind','reservation','quote',answer);
  end if;
 end loop;
 return coalesce(payment,intent);
end $$;

revoke all on function public.icash_buyer_viewing_quote(jsonb),public.icash_buyer_purchase_intent(jsonb) from public,anon,authenticated;
grant execute on function public.icash_buyer_viewing_quote(jsonb),public.icash_buyer_purchase_intent(jsonb) to service_role;
commit;
