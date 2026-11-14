CREATE OR REPLACE FUNCTION icash_reliability_private.seller_interest_quote_from_clear_transcript(p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare turn jsonb;body text;question text:='';evidence text;
begin
 if jsonb_typeof(p_result->'transcript') is distinct from 'array'
  or p_result->>'contactEvidence' in ('automated_answer','no_response') then return null;end if;
 for turn in select value from jsonb_array_elements(p_result->'transcript') loop
  if jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  body:=lower(trim(regexp_replace(translate(turn->>'message','’‘',$quote$''$quote$),'\s+',' ','g')));
  if turn->>'role'='agent' then question:=body;continue;end if;
  if turn->>'role' is distinct from 'user' then question:='';continue;end if;
  if public.icash_call_has_seller_response(jsonb_build_object('transcript',jsonb_build_array(turn))) and (
   body ~ $pattern$^((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?[.! ]*$$pattern$
   or (body ~ $pattern$^(yes|yeah|yep|sure|interested|i am interested|i'm interested|yes i am|yes,? i am interested|yes,? interested)[.! ,]*$$pattern$
    and (question='would you be open to a cash offer if the price and timing worked for you?'
     or (question ~ $pattern$(would you (be (interested in|open to)|consider)|are you (interested in|open to)|do you want to) (sell(ing)?|a cash offer)$pattern$
    and right(question,1)='?' and length(question)-length(replace(question,'?',''))=1
    and question !~ '\y(owner|own|hearing|hear|discuss|talk|information|send|permission|not|never|if|unless|maybe|learn|learning)\y')))
  ) then evidence:=turn->>'message';end if;
  question:='';
 end loop;
 return evidence;
end $function$
