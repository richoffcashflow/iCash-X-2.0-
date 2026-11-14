-- Canonical menus are not human replies. A clipped availability fragment needs
-- independent automated audio; real later speech and opt-outs still take priority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
 old:='number you (have )?dialed|';
 replacement:=old||$new$press any key to continue|^\s*(?:an? )?ai assistant recording this call for the person|^\s*please try your call again later[.! ]+(?:goodbye[.! ]*)?$|$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 or strpos(d,'press any key to continue')>0 then raise exception 'Seller screening predicate changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$^\s*at the (beep|beach)[.! ,]*thank you[.! ,]*$$old$;
 replacement:=$new$^\s*(?:at the (?:beep|beach)[.! ,]*thank you|[. ]*(?:(?:see|check) if )?(?:this )?person is available)[.! ,]*$$new$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller clipped greeting predicate changed';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
