-- Clipped English/Spanish voicemail instructions are not human responses.
-- Preserve the optimized CASE predicate and source transcripts/costs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:=$old$leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available$old$;replacement text:=$new$leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available|press the (pound|star|[0-9#*]) key|^\s*[. ]*(?:(?:when (?:that.s|you.ve|you have)|have) )?finish(?:ed)? recording[,. ]+you may hang up|^\s*[. ]*recording[, ]+you may hang up|^\s*to end recording[.! ]*$|^\s*this is a recorded message[.! ]|^\s*[¿]?(?:puedes|puede|pueden) colgar cuando hayas? terminado de grabar(?:lo)?|(?:graba|grabe|deja|deje) (?:tu|su|un) mensaje despu[eé]s (?:del tono|de la se[ñn]al)|^\s*deje despu[eé]s del tono|^\s*no se ha grabado nada[.! ]|^\s*[0-9 -]{4,16} is not available[.! ]*$$new$;
begin
 d:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 then raise exception 'Automated call evidence prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
