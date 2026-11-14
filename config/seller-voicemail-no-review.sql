-- Confirmed machine-only calls are unanswered contacts, never seller review.
-- Preserve source transcripts, opt-outs, financial records and original work.
-- Caller/migration runner owns the transaction and migration receipt.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
begin
 if md5(pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure))<>'ee4223d588abf2cdb35d812b331e1f66'
 or md5(pg_get_functiondef('public.icash_seller_gap_reason(jsonb,boolean)'::regprocedure))<>'6cac4d3d3502643e5756915912e85f58' then
  raise exception 'Voicemail classification predecessor changed';
 end if;
 execute $response$CREATE OR REPLACE FUNCTION public.icash_call_has_seller_response(p_result jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and (
  case when t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music( playing)?|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|^\s*(?:please )?leave (?:your|a) name (?:and|&) (?:number|message)(?:[, .]+(?:and )?i[''’]ll (?:call you back|get back to you)(?: as soon as possible)?)?[.! ]*$|^\s*[. ]*(?:google )?voice will try to connect you[.! ]*$|^\s*(?:one|two|1|2)[, ]+to connect your call[.! ]*$|^\s*(?:gracias[.! ]+)?permane(?:ce|zca) en la l[ií]nea[.! ]*$|^\s*(?:lo siento[.,! ]+)?esta persona no est[aá] disponible|press any key to continue|^\s*(?:an? )?ai assistant recording this call for the person|^\s*please try your call again later[.! ]+(?:goodbye[.! ]*)?$|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$'
   and (t->>'message' !~* '^\s*(?:at the (?:beep|beach)[.! ,]*thank you|[. ]*(?:(?:(?:i[''’]ll )?(?:see|check)) if )?(?:this )?person is available|[¿]?esta persona est[aá] disponible[?]?)[.! ,]*$' or not exists(
    select 1 from jsonb_array_elements(p_result->'transcript') machine
    where machine->>'role'='user' and machine->>'message' ~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|^\s*(?:please )?leave (?:your|a) name (?:and|&) (?:number|message)(?:[, .]+(?:and )?i[''’]ll (?:call you back|get back to you)(?: as soon as possible)?)?[.! ]*$|^\s*[. ]*(?:google )?voice will try to connect you[.! ]*$|^\s*(?:one|two|1|2)[, ]+to connect your call[.! ]*$|^\s*(?:gracias[.! ]+)?permane(?:ce|zca) en la l[ií]nea[.! ]*$|^\s*(?:lo siento[.,! ]+)?esta persona no est[aá] disponible|press any key to continue|^\s*(?:an? )?ai assistant recording this call for the person|^\s*please try your call again later[.! ]+(?:goodbye[.! ]*)?$|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$')) then true
   else public.icash_seller_response_disposition(t->>'message')='opt_out' end));
$function$
;$response$;
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
 if exists(select 1 from jsonb_array_elements(p_turns) x where x->>'role'='user' and public.icash_seller_contact_stop(x->>'message')) then return 'contact_stop';end if;
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

-- Retire only untouched false callback reviews from completed machine-only
-- calls. Keep their source and reason as history; never replay an operation or
-- reset a deliberate customer hold, queued message or unknown provider result.
update public.icash_seller_gaps g
set state='resolved',resolution='Automated answer only; no seller callback or review request.',
 resolved_at=now(),updated_at=now()
from public.icash_live_conversations c
where g.source='call' and g.source_id=c.id and g.account_id=c.account_id and g.screening_id=c.screening_id
 and g.reason='callback' and g.state='needs_review' and g.review_reason is null
 and g.outgoing_id is null and g.resolved_by is null and g.updated_at=g.created_at
 and c.party='seller' and c.state='complete' and c.operation_key like 'voice:%'
 and c.completed_at between now()-interval '7 days' and now()
 and not public.icash_call_has_seller_response(c.result)
 and g.quote=(select t->>'message' from jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) with ordinality x(t,n) where t->>'role'='user' order by n desc limit 1);
