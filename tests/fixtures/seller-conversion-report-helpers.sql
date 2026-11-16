-- Read-only function snapshot, 2026-11-15. No customer records.
CREATE OR REPLACE FUNCTION public.icash_seller_direct_response_match(p_body text, p_pattern text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare remaining text:=p_body;matched text;offset_start integer:=1;match_start integer;prefix text;parts text[];sentence text;
begin
 loop
  matched:=(regexp_match(remaining,'('||p_pattern||')'))[1];
  if matched is null or length(matched)=0 then return false;end if;
  match_start:=offset_start+strpos(remaining,matched)-1;
  parts:=regexp_split_to_array(left(p_body,match_start-1),'[.!?;]|\ybut\y');
  sentence:=parts[cardinality(parts)];
  if (length(sentence)-length(replace(sentence,'"','')))%2=1 then prefix:=sentence;
  else parts:=string_to_array(sentence,',');prefix:=parts[cardinality(parts)];end if;
  if coalesce(prefix,'') !~ $pattern$(?:\y(?:not|never|did not|didn't|don't|do not|was not|wasn't) (?:say|saying|said|mean|meaning|ask|asking|asked|request|requesting|want|wanted)\y[^.!?;]{0,100}|\y(?:you|they|he|she|the tenant|my tenant|the owner|the agent|my wife|my husband) (?:said|say|wrote|asked)\y[^.!?;]{0,100}|\y(?:word|phrase|example)\y[^.!?;]{0,60}|\y(?:do not|don't|dont|never|not) )$$pattern$ and coalesce(sentence,'') !~ $pattern$\y(?:not|never|did not|didn't|don't|do not) (?:say|saying|mean|meaning|ask|asking|request|requesting)[ ,"']*$$pattern$ then return true;end if;
  offset_start:=match_start+length(matched);
  remaining:=substr(p_body,offset_start);
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_seller_response_disposition(p_body text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare b text:=trim(regexp_replace(lower(replace(replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'“','"'),'”','"')),'[[:space:]]+',' ','g'));decline_body text;
begin
 if public.icash_seller_direct_response_match(b,$pattern$\y(?:do not|don't|dont) send (?:me|us) (?:any |more |any more )?(?:texts?|messages?|emails?)(?: again)?\y|(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\y(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\y|\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))|(?:unsubscribe|remove|delete) (?:me|us|(?:my|our|this) (?:phone )?number)\y|take (?:me|us|(?:my|our|this) (?:phone )?number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|us|(?:my|our|this) (?:phone )?number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$pattern$) then return 'opt_out';end if;
 if public.icash_seller_direct_response_match(b,$pattern$(?:^|[.!?;] +)(?:please )?stop[.!;](?: +|$)$pattern$) then return 'opt_out';end if;
 if public.icash_seller_direct_response_match(b,$pattern$(?:^|[.!?;] +)(?:(?:ok(?:ay)?|yes)[, ]+)?(?:never mind|nevermind|forget it|go away|go to hell)(?: please)?[.! ,]*$$pattern$) then return 'declined';end if;
 decline_body:=case when b ~ '\y(call|talk)\y' then regexp_replace(b,$pattern$\ynot (?:(?:super|very|really|that|at all) )?interested in (?:texting|emailing|emails|texts)\y$pattern$,'','g') else b end;
 if public.icash_seller_direct_response_match(decline_body,$pattern$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not (?:up )?for sale|(?:i am|i'm|we are|we're) not (?:the )?owner|(?:i|we) (?:do not|don't|dont) own (?:the |this |that |my |our )?(?:house|home|property)|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$pattern$) then
  return case when b ~ '\y(unless|if|but)\y|[$]|\yprice\y' then 'review' else 'declined' end;
 end if;
 if public.icash_seller_direct_response_match(b,$pattern$\y(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\y|\y(?:scam|scammer|scammers|fraud|fraudulent|suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then
  if strpos(b,'?')=0 and b ~ $pattern$\y(?:not|isn't|is not|wasn't|was not) (?:a )?(?:scam|fraud)\y$pattern$
   and not public.icash_seller_direct_response_match(b,$pattern$\y(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\y|\y(?:suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then return null;end if;
  return 'review';
 end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_call_is_automated_menu(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p_body ~* $pattern$^\s*if you would like to speak with a representative,\s*press (?:one|1)[.!]\s*if you would like to hang up,\s*press (?:two|2)[.!]\s*if you would like to be placed on [a-z0-9 &'’\-]{1,80}do not call list,\s*press (?:three|3)[.! ]*\s*$$pattern$,false)
$function$;

CREATE OR REPLACE FUNCTION public.icash_call_has_seller_response(p_result jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and not public.icash_call_is_automated_menu(t->>'message') and (
  case when t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music( playing)?|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|^\s*(?:please )?leave (?:your|a) name (?:and|&) (?:number|message)(?:[, .]+(?:and )?i[''’]ll (?:call you back|get back to you)(?: as soon as possible)?)?[.! ]*$|^\s*[. ]*(?:google )?voice will try to connect you[.! ]*$|^\s*(?:one|two|1|2)[, ]+to connect your call[.! ]*$|^\s*(?:gracias[.! ]+)?permane(?:ce|zca) en la l[ií]nea[.! ]*$|^\s*(?:lo siento[.,! ]+)?esta persona no est[aá] disponible[.! ]*$|press any key to continue|^\s*(?:an? )?ai assistant recording this call for the person|^\s*please try your call again later[.! ]+(?:goodbye[.! ]*)?$|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$'
   and (t->>'message' !~* '^\s*(?:at the (?:beep|beach)[.! ,]*thank you|[. ]*(?:(?:(?:i[''’]ll )?(?:see|check)) if )?(?:this )?person is available|[¿]?esta persona est[aá] disponible[?]?)[.! ,]*$' or not exists(
    select 1 from jsonb_array_elements(p_result->'transcript') machine
    where machine->>'role'='user' and machine->>'message' ~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|^\s*(?:please )?leave (?:your|a) name (?:and|&) (?:number|message)(?:[, .]+(?:and )?i[''’]ll (?:call you back|get back to you)(?: as soon as possible)?)?[.! ]*$|^\s*[. ]*(?:google )?voice will try to connect you[.! ]*$|^\s*(?:one|two|1|2)[, ]+to connect your call[.! ]*$|^\s*(?:gracias[.! ]+)?permane(?:ce|zca) en la l[ií]nea[.! ]*$|^\s*(?:lo siento[.,! ]+)?esta persona no est[aá] disponible[.! ]*$|press any key to continue|^\s*(?:an? )?ai assistant recording this call for the person|^\s*please try your call again later[.! ]+(?:goodbye[.! ]*)?$|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$')) then true
   else public.icash_seller_response_disposition(t->>'message')='opt_out' end));
$function$;

CREATE OR REPLACE FUNCTION public.icash_sms_reply_time(p_message uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when jsonb_typeof(e.payload->'timestamp')='number' then
  case when (e.payload->>'timestamp')::numeric between 0 and extract(epoch from m.created_at)+300 then (e.payload->>'timestamp')::numeric else extract(epoch from m.created_at) end
  else extract(epoch from m.created_at) end
 from public.icash_text_messages m left join public.icash_text_events e on e.id=m.event_id where m.id=p_message;
$function$;

CREATE OR REPLACE FUNCTION public.icash_learning_signature_verified(e icash_signing_envelopes)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare d jsonb:=e.provider_evidence;r jsonb;match jsonb;ordinal bigint;
begin
 if e.test_mode is distinct from false or e.state is distinct from 'completed' or e.provider_id is null
  or d->>'id' is distinct from e.provider_id or d->'test_mode' is distinct from 'false'::jsonb
  or lower(d->>'status') is distinct from 'completed' or d->'apply_signing_order' is distinct from 'true'::jsonb
  or d->'metadata'->>'icash_envelope' is distinct from e.id::text or d->'metadata'->>'terms_hash' is distinct from e.terms_hash
  or jsonb_typeof(e.recipients) is distinct from 'array' or jsonb_typeof(d->'recipients') is distinct from 'array' then return false;end if;
 if jsonb_array_length(e.recipients)<2 or jsonb_array_length(e.recipients)<>jsonb_array_length(d->'recipients')
  or (select count(distinct value->>'id') from jsonb_array_elements(e.recipients))<>jsonb_array_length(e.recipients)
  or (select count(distinct value->>'id') from jsonb_array_elements(d->'recipients'))<>jsonb_array_length(e.recipients) then return false;end if;
 for r,ordinal in select value,ordinality from jsonb_array_elements(e.recipients) with ordinality loop
  select value into match from jsonb_array_elements(d->'recipients') where value->>'id'=r->>'id';
  if match is null or lower(match->>'status') is distinct from 'signed' or match->'signing_order' is distinct from to_jsonb(ordinal)
   or (case when nullif(r->>'phone','') is not null then match->>'phone' is distinct from r->>'phone'
     else nullif(r->>'email','') is null or lower(match->>'email') is distinct from lower(r->>'email') end) then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $function$;
