-- Restore previously recognized direct contact withdrawals without changing
-- soft declines, quoted/negated speech, or the existing gerund forms.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;
 original_pattern text:=$old$(?:stop|quit) (?:calling|texting|emailing|messaging|contacting)\y$old$;
 replacement_pattern text:=$new$(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\y|(?:call|text|email|message|contact)\y(?! (?:it|that|the house|the property)\y))$new$;
begin
 definition:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 if (length(definition)-length(replace(definition,original_pattern,'')))<>length(original_pattern) then
  raise exception 'Seller opt-out base-verb prerequisite changed';
 end if;
 execute replace(definition,original_pattern,replacement_pattern);
end $patch$;
commit;
