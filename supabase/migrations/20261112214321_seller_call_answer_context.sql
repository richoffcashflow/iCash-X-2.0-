-- Source-bound ownership and selling refusals; never infer an opt-out from no.
-- No provider requests, historical replay, new contact authority or UI change.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure))<>'070b7300e48791b0aa5f30c2c6caf6d3'
  or md5(pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure))<>'dff2b608dfa29241520e97d89c037715'
 then raise exception 'Seller call context prerequisite changed';end if;
end $guard$;
create function public.icash_seller_call_answer_disposition(p_question text,p_answer text)
returns text language plpgsql immutable security invoker set search_path='' as $fn$
declare q text:=lower(btrim(regexp_replace(replace(coalesce(p_question,''),'’',chr(39)),'[[:space:]]+',' ','g')));
 a text:=lower(btrim(regexp_replace(replace(coalesce(p_answer,''),'’',chr(39)),'[[:space:]]+',' ','g')));last_question text;
begin
 select part into last_question from unnest(string_to_array(q,'?')) with ordinality parts(part,n) where btrim(part)<>'' order by n desc limit 1;
 if last_question ~ $pattern$\y(?:is this|are you|am i (?:speaking|talking) (?:to|with)) (?:the )?(?:property )?owner\y|\ydo you (?:still )?own\y|\yis .{1,100} (?:your (?:house|home|property)|yours)\y$pattern$ then
  if a ~ $pattern$^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$$pattern$ then return 'declined';end if;
  if a ~ $pattern$^(?:no|nope|nah|naw)\y$pattern$ then return 'review';end if;
 end if;
 if last_question ~ $pattern$\y(?:interested.{0,35}(?:sell|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\y$pattern$ and a ~ $pattern$^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$$pattern$ then return 'declined';end if;
 return null;
end $fn$;
revoke all on function public.icash_seller_call_answer_disposition(text,text) from public,anon,authenticated;
grant execute on function public.icash_seller_call_answer_disposition(text,text) to service_role;
do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure);
 old:=$old$  if current_disposition is null and trim(message) ~* '^no([,! .]+(thanks|thank you|gracias))?[.! ]*$'
   and last_agent ~* 'interested.{0,35}(sell|cash offer)|consider selling|want to sell|open to.{0,15}cash offer' then current_disposition:='declined';end if;$old$;
 replacement:=$new$  if current_disposition='declined' and btrim(last_agent)<>''
   and lower(btrim(regexp_replace(replace(message,'’',chr(39)),'[[:space:]]+',' ','g'))) ~ $answer$^no[,! .]+(?:thanks|thank you|gracias)[.! ,]*$$answer$ then
   current_disposition:=public.icash_seller_call_answer_disposition(last_agent,message);
  end if;
  if current_disposition is null then current_disposition:=public.icash_seller_call_answer_disposition(last_agent,message);end if;$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller call answer patch changed';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 old:=$old$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not for sale|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$old$;
 replacement:=$new$\y(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\y|\y(?:i|we) (?:will not|won't|wont) (?:ever )?sell\y|\y(?:no thanks|no thank you|wrong (?:phone )?number|not (?:up )?for sale|(?:i am|i'm|we are|we're) not (?:the )?owner|(?:i|we) (?:do not|don't|dont) own (?:the |this |that |my |our )?(?:house|home|property)|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\y$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller direct refusal patch changed';end if;
 execute replace(d,old,replacement);
end $patch$;
