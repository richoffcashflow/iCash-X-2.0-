-- Keep prior consent records intact; accept the new public wording for future requests.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_submit_seller_contact_intake(uuid,text,text,text,text,text,boolean,text,text,text,jsonb,text,text)'::regprocedure);
 needle:=$old$p_consent_version<>'homeoffer-seller-contact-2026-10-05.2'$old$;
 if position(needle in definition)=0 then raise exception 'Seller consent version check changed';end if;
 definition:=replace(definition,needle,$new$p_consent_version not in ('homeoffer-seller-contact-2026-10-05.2','homeoffer-seller-contact-2026-10-05.3')$new$);
 execute definition;
end $patch$;
