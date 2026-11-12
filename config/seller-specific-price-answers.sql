-- A no to a specific amount is not a refusal to sell; ownership and explicit
-- source-word opt-outs/refusals retain their precedence. No historical replay.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:=' if last_question ~ $pattern$\y(?:interested';replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_call_answer_disposition(text,text)'::regprocedure);
 if md5(d)<>'8c985000cf6cbb2c68f2d239c9e9af5e' or (length(d)-length(replace(d,old,'')))<>length(old)
 then raise exception 'Seller price answer prerequisite changed';end if;
 replacement:=$new$ if last_question ~ $price$\$\s*[0-9]|\y[0-9][0-9,.]*\s*(?:dollars?|grand|thousand|million|k|m)\y|\y(?:hundred|thousand|million) (?:dollars?|cash|offer)\y$price$ then return null;end if;
$new$||old;
 execute replace(d,old,replacement);
end $patch$;
