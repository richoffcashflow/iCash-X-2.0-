-- Spoken/numeric offer amounts can omit currency markers. Keep the amount
-- attached to a price phrase so property numbers and time periods are not prices.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:=' if last_question ~ $pattern$\y(?:interested';replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_call_answer_disposition(text,text)'::regprocedure);
 if md5(d)<>'7571f46837b97db220d5753e142c1257' or (length(d)-length(replace(d,old,'')))<>length(old)
 then raise exception 'Seller unmarked price prerequisite changed';end if;
 replacement:=$new$ if last_question ~ $price$\y(?:sell(?:ing)?(?: (?:it|your (?:home|house|property)|the (?:home|house|property)))? (?:for|at)|(?:cash )?offer (?:of|at)|price (?:of|at|is)) (?:about |around |roughly )?(?:[0-9][0-9,.]*(?=\s*(?:[?!.]|$|if\y|with\y))|(?:(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|and) ){1,7}(?:hundred|thousand|million|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\y)$price$ then return null;end if;
$new$||old;
 execute replace(d,old,replacement);
end $patch$;
