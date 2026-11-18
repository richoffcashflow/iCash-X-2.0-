-- Prospective source-word hard stops. No history rewrite, outbound work or backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_seller_hard_stop(p_body text) returns boolean
language plpgsql immutable security invoker set search_path='' as $fn$
declare b text:=trim(regexp_replace(lower(replace(replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'“','"'),'”','"')),'[[:space:]]+',' ','g'));
 pattern text;matches text[];matched text;offset_start integer;match_start integer;prefix text;parts text[];sentence text;before_match text;
begin
 foreach pattern in array array[
  $pattern$^(?:please )?(?:stop|stopall|unsubscribe|opt out|dnc)(?:[.!?,;]+(?: |$)| +(?=(?:who|what|why|how|your offer)\y))|\y(?:stop|quit) sending (?:me |us )?(?:any |more |any more )?(?:fucking |damn )?(?:texts?|messages?|emails?)\y$pattern$,
  $pattern$\y(?:fuck (?:you|off)|go fuck yourself|shut (?:the (?:fuck|hell) )?up|go (?:the fuck )?away|go to hell|(?:stop|quit) (?:fucking|damn) (?:calling|texting|contacting|bothering|harassing)(?: me| us)?|(?:are you|you are|you're|youre|you) (?:a |an )?(?:fucking |goddamn )(?:idiot|moron)|(?:you are|you're|youre|you) (?:a |an )?(?:fucking |goddamn )?(?:asshole|assholes|bastard|bastards|motherfucker|motherfuckers|piece of shit))\y$pattern$,
  $pattern$\y(?:(?:i|we) (?:will|'ll|am going to|are going to|am gonna|are gonna) (?:sue you|sue your (?:company|business)|take legal action against you|report (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general))|(?:i'm|we're|im|were) (?:going to|gonna) (?:sue you|report (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general))|(?:i'll|we'll) (?:sue you|report (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general))|(?:i|we) (?:have )?(?:already )?reported (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general)|this is harassment|(?:this|your) (?:call|text|contact|calling|texting) (?:is|constitutes) (?:illegal|harassment)|(?:you are|you're|youre) (?:harassing me|violating (?:the )?(?:do not call|dnc|tcpa))|(?:my|our) (?:lawyer|attorney) (?:will|is going to) (?:sue you|contact you about (?:these|your) (?:calls|texts)))\y$pattern$,
  $pattern$\y(?:(?:i am|i'm|im|we are|we're|were|my (?:phone )?number is|this (?:phone )?number is) (?:already )?on (?:the |your |a |the national |the federal )?(?:dnc|do[ -]not[ -]call)(?: (?:list|registry))?|(?:put|place|add) (?:me|us|my (?:phone )?number|this (?:phone )?number) (?:on|in) (?:the |your |a )?(?:do[ -]not[ -]call|dnc)(?: (?:list|registry))?)\y$pattern$,
  $pattern$\y(?:(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no|(?:i|we) (?:will never|would never|am never going to|are never going to) sell|(?:i'm|we're|im|were) never (?:going to sell|selling)|(?:absolutely|definitely|completely) not interested(?: in selling)?|not (?:at all|remotely|even slightly|fucking) interested(?: in selling)?|not interested (?:at all|whatsoever)|(?:i|we) have (?:absolutely )?(?:zero|no) interest in selling|(?:zero|no) fucking interest(?: in selling)?)\y(?! in (?!selling\y))(?![^.!?;]*(?:\y(?:unless|if|until|when|price|offer|amount|(?:for|at) (?:that|this|[0-9]))\y|\$))$pattern$
 ] loop
  offset_start:=1;
  for matches in select regexp_matches(b,'('||pattern||')','g') loop
   matched:=matches[1];
   match_start:=offset_start+strpos(substr(b,offset_start),matched)-1;
   before_match:=left(b,match_start-1);
   -- Quoted speech remains reported across punctuation inside the quotation.
   if (length(before_match)-length(replace(before_match,'"','')))%2=0 then
    parts:=regexp_split_to_array(before_match,'[.!?;]|\ybut\y');sentence:=parts[cardinality(parts)];
    if (length(sentence)-length(replace(sentence,'"','')))%2=1 then prefix:=sentence;
    else parts:=string_to_array(sentence,',');prefix:=parts[cardinality(parts)];end if;
    if coalesce(prefix,'') !~ $pattern$(?:\y(?:not|never|did not|didn't|don't|do not|was not|wasn't) (?:say|saying|said|mean|meaning|ask|asking|asked|request|requesting|want|wanted)\y[^.!?;]{0,100}|\y(?:you|they|he|she|the tenant|my tenant|the owner|the agent|my wife|my husband) (?:said|say|wrote|asked)\y[^.!?;]{0,100}|\y(?:word|phrase|example)\y[^.!?;]{0,60}|\y(?:do not|don't|dont|never|not) )$$pattern$
     and coalesce(sentence,'') !~ $nonrequest$(?:\y(?:won't|wont|will not|wouldn't|wouldnt|would not|can't|cannot) (?:say|tell|use|repeat)\y[^.!?;]{0,100}|\y(?:my|our|the|a) (?:seller|buyer|lawyer|attorney|tenant|agent|friend) (?:said|says|wrote|asked)\y[^.!?;]{0,100}|\y(?:what does|what do you mean by|meaning of|definition of) ["']?)$$nonrequest$
     and coalesce(sentence,'') !~ $pattern$\y(?:not|never|did not|didn't|don't|do not) (?:say|saying|mean|meaning|ask|asking|request|requesting)[ ,"']*$$pattern$ then return true;end if;
   end if;
   offset_start:=match_start+length(matched);
  end loop;
 end loop;
 return false;
end $fn$;
revoke all on function public.icash_seller_hard_stop(text) from public,anon,authenticated;
grant execute on function public.icash_seller_hard_stop(text) to service_role;
do $patch$
declare d text;old text:=E'begin\n if public.icash_seller_direct_response_match(b,';
begin
 d:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))<>length(old)
  or strpos(d,'never mind')=0 or strpos(d,'icash_seller_hard_stop')>0 then
  raise exception 'Seller hard-stop prerequisite changed';
 end if;
 execute replace(d,old,E'begin\n if public.icash_seller_hard_stop(b) then return ''opt_out'';end if;\n if public.icash_seller_direct_response_match(b,');
end $patch$;
do $answer_patch$
declare d text;old text:=$old$ if last_question ~ $pattern$\y(?:interested$old$;
 interest_old text:=$interest_old$\y(?:interested.{0,35}(?:sell|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\y$interest_old$;
 ownership_old text:=$ownership_old$ if last_question ~ $pattern$\y(?:is this|are you|am i (?:speaking|talking) (?:to|with)) (?:the )?(?:property )?owner\y|\ydo you (?:still )?own\y|\yis .{1,100} (?:your (?:house|home|property)|yours)\y$pattern$ then$ownership_old$;
begin
 d:=pg_get_functiondef('public.icash_seller_call_answer_disposition(text,text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))<>length(old)
  or (length(d)-length(replace(d,interest_old,'')))<>length(interest_old)
  or (length(d)-length(replace(d,ownership_old,'')))<>length(ownership_old)
  or strpos(d,'$price$')=0 or strpos(d,'hell')>0 then raise exception 'Seller strong-answer prerequisite changed';end if;
 d:=replace(d,old,$new$ if last_question ~ $interest$\y(?:interested.{0,35}(?:sell(?:ing)?|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\y$interest$
  and a ~ $answer$^(?:hell (?:no|nah)|fuck no|absolutely not|no[,! .]+(?:way|fucking way))(?:[.! ,]*$|[.!?,;]+ +(?=who (?:is|are)\y|what (?:is your|company)\y|why are you\y))$answer$ then return 'opt_out';end if;
 if last_question ~ $pattern$\y(?:interested$new$);
 d:=replace(d,interest_old,$interest_new$\y(?:interested.{0,35}(?:sell(?:ing)?|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\y$interest_new$);
 d:=replace(d,ownership_old,ownership_old||E'\n'||$ownership_new$  if a ~ $answer$^(?:hell (?:no|nah)|fuck no|absolutely not|no[,! .]+(?:way|fucking way))(?:[.! ,]*$|[.!?,;]+ +(?=who (?:is|are)\y|what (?:is your|company)\y|why are you\y))$answer$ then return 'declined';end if;$ownership_new$);
 execute d;
end $answer_patch$;
commit;
