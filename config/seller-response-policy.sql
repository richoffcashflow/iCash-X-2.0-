begin;
set local lock_timeout='3s';
-- Source-word policy, not sentiment scoring. Soft responses pause automation;
-- only direct stop-contact requests establish permanent suppression.
-- Regex constants are mirrored in lib/seller-response-policy.ts and parity-tested.
create function public.icash_seller_direct_response_match(p_body text,p_pattern text) returns boolean
language plpgsql immutable security invoker set search_path='' as $fn$
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
end $fn$;

create function public.icash_seller_response_disposition(p_body text) returns text
language plpgsql immutable security invoker set search_path='' as $fn$
declare b text:=trim(regexp_replace(lower(replace(replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'“','"'),'”','"')),'[[:space:]]+',' ','g'));decline_body text;
begin
 if public.icash_seller_direct_response_match(b,$pattern$\yplease unsubscribe(?: me)?\y|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\s*[,;.!]\s*(?:please\y|call\y|text\y|but\y))|\y(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\y|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\y(?! (?:it|that|the house|the property)\y)|(?:stop|quit) (?:calling|texting|emailing|messaging|contacting)\y|(?:unsubscribe|remove|delete) (?:me|my number)\y|take (?:me|my number) off\y|leave (?:me|us) alone\y|(?:put|add|place) (?:me|my number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\y|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\y)$pattern$) then return 'opt_out';end if;
 decline_body:=case when b ~ '\y(call|talk)\y' then regexp_replace(b,$pattern$\ynot (?:(?:super|very|really|that|at all) )?interested in (?:texting|emailing|emails|texts)\y$pattern$,'','g') else b end;
 if public.icash_seller_direct_response_match(decline_body,$pattern$\y(?:no thanks|no thank you|wrong number|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$pattern$) then
  return case when b ~ '\y(unless|if|but)\y|[$]|\yprice\y' then 'review' else 'declined' end;
 end if;
 if public.icash_seller_direct_response_match(b,$pattern$\y(?:scam|scammer|scammers|fraud|fraudulent|suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then
  if strpos(b,'?')=0 and b ~ $pattern$\y(?:not|isn't|is not|wasn't|was not) (?:a )?(?:scam|fraud)\y$pattern$
   and not public.icash_seller_direct_response_match(b,$pattern$\y(?:suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\y|^(?:not comfortable|not ready)[.! ,]*$$pattern$) then return null;end if;
  return 'review';
 end if;
 return null;
end $fn$;

create function public.icash_seller_call_disposition(p_result jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $fn$
declare turns jsonb:=case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end;
 turn jsonb;message text;last_agent text:='';current_disposition text;disposition text;
begin
 if exists(select 1 from jsonb_array_elements(turns) t where t->>'role'='user' and public.icash_seller_response_disposition(t->>'message')='opt_out') then return 'opt_out';end if;
 if not exists(select 1 from jsonb_array_elements(turns) t where t->>'role'='user' and t->>'message' ~* '[a-z0-9]') then return null;end if;
 for turn in select value from jsonb_array_elements(turns) loop
  message:=turn->>'message';
  if turn->>'role'='agent' then last_agent:=coalesce(message,'');continue;end if;
  if turn->>'role' is distinct from 'user' or jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  if trim(message) ~* $pattern$^(?:(?:hi|hello)[,.! ]+)?(?:you.{0,8}(?:have reached|ve reached)|(?:this is |welcome to ).{0,60}(?:voice[ -]?mail|mailbox|automated (?:system|assistant))|(?:please )?leave.{0,25}(?:message|name|number)|after.{0,12}(?:tone|beep)|(?:the person|the subscriber|the number|your call|the call|this number).{0,80}(?:not available|unavailable|forwarded|disconnected|not in service)|no one is available|press [0-9]|comunicarte.{0,30}no est[aá] disponible|(?:buz[oó]n de voz|correo de voz)|(?:graba|grabe|deja|deje).{0,25}mensaje)$pattern$ then last_agent:='';continue;end if;
  current_disposition:=public.icash_seller_response_disposition(message);
  if current_disposition is null and trim(message) ~* '^no([,! .]+(thanks|thank you|gracias))?[.! ]*$'
   and last_agent ~* 'interested.{0,35}(sell|cash offer)|consider selling|want to sell|open to.{0,15}cash offer' then current_disposition:='declined';end if;
  if current_disposition='opt_out' then return current_disposition;end if;
  if current_disposition='declined' or disposition is null then disposition:=current_disposition;end if;
  last_agent:='';
 end loop;
 return disposition;
end $fn$;

create or replace function public.icash_seller_contact_stop(p_body text) returns boolean
language sql immutable security invoker set search_path='' as $fn$
 select coalesce(public.icash_seller_response_disposition(p_body)='opt_out',false)
$fn$;
revoke all on function public.icash_seller_direct_response_match(text,text),public.icash_seller_response_disposition(text),public.icash_seller_call_disposition(jsonb),public.icash_seller_contact_stop(text) from public,anon,authenticated;
grant execute on function public.icash_seller_direct_response_match(text,text),public.icash_seller_response_disposition(text),public.icash_seller_call_disposition(jsonb),public.icash_seller_contact_stop(text) to service_role;
commit;
