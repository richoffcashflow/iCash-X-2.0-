CREATE OR REPLACE FUNCTION public.icash_call_has_seller_response(p_result jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and (
  case when t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?(additional )?message|record (a |your )?message|(at|after) the (beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call' then true
   else public.icash_seller_response_disposition(t->>'message')='opt_out' end));
$function$
