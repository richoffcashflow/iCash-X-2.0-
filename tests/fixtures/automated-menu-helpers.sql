CREATE OR REPLACE FUNCTION public.icash_seller_identity_question(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select count(*) between 1 and 3 and coalesce(bool_and(part ~* '^(who (is this|are you)|who[''’]?s this|what (company|business) is this|(are you|is this) (a |an )?(human( being)?|real person|ai|bot|robot|automated)( or (a |an )?(human( being)?|real person|ai|bot|robot|automated))?)$'),false)
 from (select btrim(value) as part from regexp_split_to_table(coalesce(p_body,''),'[?!.]+') value where btrim(value)<>'') clauses
$function$
;


CREATE OR REPLACE FUNCTION public.icash_seller_call_answer_disposition(p_question text, p_answer text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare q text:=lower(btrim(regexp_replace(replace(coalesce(p_question,''),'’',chr(39)),'[[:space:]]+',' ','g')));
 a text:=lower(btrim(regexp_replace(replace(coalesce(p_answer,''),'’',chr(39)),'[[:space:]]+',' ','g')));last_question text;
begin
 select part into last_question from unnest(string_to_array(q,'?')) with ordinality parts(part,n) where btrim(part)<>'' order by n desc limit 1;
 if last_question ~ $pattern$\y(?:is this|are you|am i (?:speaking|talking) (?:to|with)) (?:the )?(?:property )?owner\y|\ydo you (?:still )?own\y|\yis .{1,100} (?:your (?:house|home|property)|yours)\y$pattern$ then
  if a ~ $pattern$^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$$pattern$ then return 'declined';end if;
  if a ~ $pattern$^(?:no|nope|nah|naw)\y$pattern$ then return 'review';end if;
 end if;
 if last_question ~ $price$\$\s*[0-9]|\y[0-9][0-9,.]*\s*(?:dollars?|grand|thousand|million|k|m)\y|\y(?:hundred|thousand|million) (?:dollars?|cash|offer)\y$price$ then return null;end if;
 if last_question ~ $price$\y(?:sell(?:ing)?(?: (?:it|your (?:home|house|property)|the (?:home|house|property)))? (?:for|at)|(?:cash )?offer (?:of|at)|price (?:of|at|is)) (?:about |around |roughly )?(?:[0-9][0-9,.]*(?=\s*(?:[?!.]|$|if\y|with\y))|(?:(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|and) ){1,7}(?:hundred|thousand|million|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\y)$price$ then return null;end if;
 if last_question ~ $pattern$\y(?:interested.{0,35}(?:sell|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\y$pattern$ and a ~ $pattern$^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$$pattern$ then return 'declined';end if;
 return null;
end $function$
;


CREATE OR REPLACE FUNCTION public.icash_seller_conversation_human(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(not public.icash_seller_identity_question(p_body) and p_body ~* '\m(human|real person|(speak|talk) (to|with) (someone|(a |an |the |your )?(person|manager|owner|supervisor|representative)))\M',false)
$function$
;
