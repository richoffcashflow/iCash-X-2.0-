-- Support inbox audit: source recordings must not count as seller responses.
-- Preserve the installed fast path, opt-outs, original transcripts and all costs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:=$old$and t->>'message' !~* 'leave (a |an |your )?(additional )?message|record (a |your )?message|(at|after) the (beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call'$old$;
replacement text:=$new$and t->>'message' !~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available'
   and (t->>'message' !~* '^\s*at the (beep|beach)[.! ,]*thank you[.! ,]*$' or not exists(
    select 1 from jsonb_array_elements(p_result->'transcript') machine
    where machine->>'role'='user' and machine->>'message' ~* 'leave (a |an |your )?((additional|brief|short) )?message|record (a |your )?message|(at|after) the (sound of the )?(beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call|when you( have|[’'']ve|ve) finished recording|^\s*(stay|hold|remain) on the line[.! ]*$|this person is not available'))$new$;
begin
 d:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'Seller response predicate changed; review before applying';
 end if;
 execute replace(d,old,replacement);
end $patch$;
-- Bounded existing refresh path recomputes derived history; no source mutation.
update public.icash_opportunity_refreshes set refreshed_at='-infinity'::timestamptz;
commit;
