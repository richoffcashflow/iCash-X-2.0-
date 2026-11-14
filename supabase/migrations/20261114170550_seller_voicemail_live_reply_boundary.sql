-- Preserve a live speaker continuing an unavailable-person announcement.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
 old_pattern text:='^\s*(?:lo siento[.,! ]+)?esta persona no est[aá] disponible';
begin
 if md5(definition)<>'bb3ba3ca77c0514ee6d21e27f18a7a15' then raise exception 'Live-reply boundary predecessor changed';end if;
 execute replace(definition,old_pattern,old_pattern||'[.! ]*$');
end $patch$;
