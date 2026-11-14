-- Complete IVR menus do not request a person or opt out on the seller's behalf.
-- Current source, explicit later stop requests and all SMS policy remain intact.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
begin
 if md5(pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure))<>'327a1732d83fc97fd6eaedc3b08417a8'
 or md5(pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure))<>'de7411202431656d8c8a4be5ddf88d7b'
 or md5(pg_get_functiondef('public.icash_seller_gap_reason(jsonb,boolean)'::regprocedure))<>'30843675bbfb0cfbbe7d330f89559d34'
 or to_regprocedure('public.icash_call_is_automated_menu(text)') is not null then
  raise exception 'Automated menu evidence predecessor changed';
 end if;
 execute $menu$CREATE FUNCTION public.icash_call_is_automated_menu(p_body text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
 select coalesce(p_body ~* $pattern$^\s*if you would like to speak with a representative,\s*press (?:one|1)[.!]\s*if you would like to hang up,\s*press (?:two|2)[.!]\s*if you would like to be placed on [a-z0-9 &'’\-]{1,80}do not call list,\s*press (?:three|3)[.! ]*\s*$$pattern$,false)
$function$;$menu$;
 execute $response$CREATE OR REPLACE FUNCTION public.icash_call_has_seller_response(p_result jsonb)
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
$function$
;$response$;
 execute $disposition$CREATE OR REPLACE FUNCTION public.icash_seller_call_disposition(p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare turns jsonb:=case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end;
 turn jsonb;message text;last_agent text:='';current_disposition text;disposition text;
begin
 if exists(select 1 from jsonb_array_elements(turns) t where t->>'role'='user' and not public.icash_call_is_automated_menu(t->>'message') and public.icash_seller_response_disposition(t->>'message')='opt_out') then return 'opt_out';end if;
 if not exists(select 1 from jsonb_array_elements(turns) t where t->>'role'='user' and t->>'message' ~* '[a-z0-9]') then return null;end if;
 for turn in select value from jsonb_array_elements(turns) loop
  message:=turn->>'message';
  if turn->>'role'='agent' then last_agent:=coalesce(message,'');continue;end if;
  if turn->>'role' is distinct from 'user' or jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  if public.icash_call_is_automated_menu(message) then last_agent:='';continue;end if;
  if trim(message) ~* $pattern$^(?:(?:hi|hello)[,.! ]+)?(?:you.{0,8}(?:have reached|ve reached)|(?:this is |welcome to ).{0,60}(?:voice[ -]?mail|mailbox|automated (?:system|assistant))|(?:please )?leave.{0,25}(?:message|name|number)|after.{0,12}(?:tone|beep)|(?:the person|the subscriber|the number|your call|the call|this number).{0,80}(?:not available|unavailable|forwarded|disconnected|not in service)|no se ha grabado nada[.! ]|no one is available|press [0-9]|comunicarte.{0,30}no est[aá] disponible|(?:buz[oó]n de voz|correo de voz)|(?:graba|grabe|deja|deje).{0,25}mensaje)$pattern$ then last_agent:='';continue;end if;
  current_disposition:=public.icash_seller_response_disposition(message);
  if current_disposition='declined' and btrim(last_agent)<>''
   and lower(btrim(regexp_replace(replace(message,'’',chr(39)),'[[:space:]]+',' ','g'))) ~ $answer$^no[,! .]+(?:thanks|thank you|gracias)[.! ,]*$$answer$ then
   current_disposition:=public.icash_seller_call_answer_disposition(last_agent,message);
  end if;
  if current_disposition is null then current_disposition:=public.icash_seller_call_answer_disposition(last_agent,message);end if;
  if current_disposition='opt_out' then return current_disposition;end if;
  if current_disposition='declined' or disposition is null then disposition:=current_disposition;end if;
  last_agent:='';
 end loop;
 return disposition;
end $function$
;$disposition$;
 execute $gap$CREATE OR REPLACE FUNCTION public.icash_seller_gap_reason(p_turns jsonb, p_review boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare b text;agent text;repeated boolean;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return case when p_review then 'unanswered' end;end if;
 select value->>'message' into b from jsonb_array_elements(p_turns) with ordinality x(value,n) where value->>'role'='user' order by n desc limit 1;
 select value->>'message' into agent from jsonb_array_elements(p_turns) with ordinality x(value,n) where value->>'role'='agent' order by n desc limit 1;
 if exists(select 1 from jsonb_array_elements(p_turns) x where x->>'role'='user' and (p_review or not public.icash_call_is_automated_menu(x->>'message')) and public.icash_seller_contact_stop(x->>'message')) then return 'contact_stop';end if;
 -- Whole source turns decide whether a person answered before interpreting a
 -- mailbox's callback wording. SMS review is a separate source lane.
 if not p_review and not public.icash_call_has_seller_response(jsonb_build_object('transcript',p_turns)) then return 'no_response';end if;
 if public.icash_seller_conversation_human(b) then return 'human';end if;
 if public.icash_seller_response_disposition(b) in ('declined','review') then return 'declined';end if;
 if b ~* '\m(spouse|wife|husband|co-owner|other owner|another owner|decision maker)\M' then return 'owners';end if;
 if b ~* '\m(lien|liens|unpaid taxes|probate|bankruptcy|foreclosure|agent agreement|attorney|lawyer)\M' then return 'material_facts';end if;
 if b ~* '\m(call me|call back|callback|call tomorrow|call today)\M' then return 'callback';end if;
 -- Shared seller response policy owns negative-response classification.
 if b is null then return 'no_response';end if;
 select exists(select 1 from jsonb_array_elements(p_turns) x where x->>'role'='agent' and x->>'message' like '%?%' group by lower(btrim(x->>'message')) having count(*)>=3) into repeated;
 if repeated then return 'repeated_question';end if;
 if p_review or agent ~* '\m(don''t know|do not know|cannot answer|can''t answer|unable to answer|needs review|need to check|temporarily unavailable)\M' then return 'unanswered';end if;
 return null;
end $function$
;$gap$;
end $patch$;
revoke all on function public.icash_call_is_automated_menu(text) from public,anon,authenticated;
grant execute on function public.icash_call_is_automated_menu(text) to service_role;

-- Older untouched machine callback reviews remain visible unless retired too.
-- No transcript, control, queued send, attempt, charge or operation is replayed.
update public.icash_seller_gaps g
set state='resolved',resolution='Automated answer only; no seller callback or review request.',resolved_at=now(),updated_at=now()
from public.icash_live_conversations c
where g.source='call' and g.source_id=c.id and g.account_id=c.account_id and g.screening_id=c.screening_id
 and g.reason='callback' and g.state='needs_review' and g.review_reason is null
 and g.outgoing_id is null and g.resolved_by is null and g.updated_at=g.created_at
 and c.party='seller' and c.state='complete' and c.operation_key like 'voice:%' and c.completed_at<=now()
 and exists(select 1 from public.icash_screening_jobs s where s.id=g.screening_id and s.account_id=g.account_id and s.state='complete')
 and not public.icash_call_has_seller_response(c.result)
 and g.quote=(select t->>'message' from jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) with ordinality x(t,n) where t->>'role'='user' order by n desc limit 1);

-- Retire the automatically created review, without changing manual control:
-- the handoff writer overwrites an existing control and stores no provenance.
update public.icash_handoffs h
set state='resolved',resolution='Automated menu only; no seller request for a person.',resolved_at=now(),updated_at=now()
from public.icash_live_conversations c
where h.conversation_id=c.id and h.account_id=c.account_id and h.screening_id=c.screening_id
 and h.party='seller' and c.party='seller' and c.state='complete' and c.operation_key like 'voice:%'
 and c.completed_at=h.created_at and c.result->>'humanRequested'='true'
 and h.reason='Requested a person' and h.state='open' and h.updated_at=h.created_at
 and h.assigned_to='Account owner' and h.due_at=h.created_at+interval '2 hours'
 and h.resolution is null and h.closing_setup_id is null and h.text_attention_id is null and h.portal_journey_id is null
 and exists(select 1 from public.icash_screening_jobs s where s.id=h.screening_id and s.account_id=h.account_id and s.state='complete')
 and (select count(*)=1 and bool_and(public.icash_call_is_automated_menu(t->>'message'))
      from jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) t where t->>'role'='user');
