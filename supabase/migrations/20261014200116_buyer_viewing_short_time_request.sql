begin;
set local lock_timeout='3s';
-- An explicit first-person viewing request may name only a day or time.
-- The bound property is already known; no appointment or access is created.
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
     or clause ~ '^(can|could|may) (i|we) (see|view|visit)( on| at)? (today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[0-9]{1,2}(:[0-9]{2})? (am|pm))([[:space:]]|$)'
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
revoke all on function public.icash_buyer_viewing_quote(jsonb) from public,anon,authenticated;
grant execute on function public.icash_buyer_viewing_quote(jsonb) to service_role;
commit;
