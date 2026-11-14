-- Do not change pre-existing queued fingerprints while conversion is inactive.
-- A true flag still joins the fingerprint and disappears on late disable.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 old:=$old$c:=jsonb_build_object('conversionEnabled',public.icash_seller_conversion_source(p_account,m.id),'accountId',p_account,$old$;
 replacement:=$new$c:=case when public.icash_seller_conversion_source(p_account,m.id) then '{"conversionEnabled":true}'::jsonb else '{}'::jsonb end||jsonb_build_object('accountId',p_account,$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller inactive fingerprint prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
