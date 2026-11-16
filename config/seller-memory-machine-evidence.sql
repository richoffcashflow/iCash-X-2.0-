-- Exact fragment; a person explaining a failed recording remains human.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare d text:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
 needle text:=$n$|^\s*no se ha grabado nada[.! ]$n$;
begin
 if md5(d)<>'8912be25a77473b2a09dc88b30885ae4' then raise exception 'Seller machine memory predecessor changed';end if;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Seller machine memory anchors changed';end if;
 execute replace(d,needle,$n$|^\s*nothing has been recorded[.! ]*$$n$||needle);
end $patch$;
