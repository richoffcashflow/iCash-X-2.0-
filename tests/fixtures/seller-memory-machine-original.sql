CREATE OR REPLACE FUNCTION public.icash_call_is_automated_menu(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p_body ~* $pattern$^\s*if you would like to speak with a representative,\s*press (?:one|1)[.!]\s*if you would like to hang up,\s*press (?:two|2)[.!]\s*if you would like to be placed on [a-z0-9 &'’\-]{1,80}do not call list,\s*press (?:three|3)[.! ]*\s*$$pattern$,false)
$function$
;
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
$function$
;
