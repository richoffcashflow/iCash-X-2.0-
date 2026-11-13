-- Keep a canonical Spanish voicemail beginning with no out of seller refusals.
-- Caller owns the transaction; original transcripts and contact authority stay intact.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:='|no one is available|press [0-9]';
 replacement text:='|no se ha grabado nada[.! ]|no one is available|press [0-9]';
begin
 d:=pg_get_functiondef('public.icash_seller_call_disposition(jsonb)'::regprocedure);
 if md5(d)<>'7fa8cdc84ba7694537694a4d52e45001' or (length(d)-length(replace(d,old,'')))<>length(old)
 then raise exception 'Seller automated greeting prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
