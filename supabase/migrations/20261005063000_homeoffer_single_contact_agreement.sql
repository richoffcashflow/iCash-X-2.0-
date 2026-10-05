-- Only the new form requires an affirmative contact choice. Historical records stay intact.
-- Removing the ownership checkbox must not fabricate an ownership declaration.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_submit_seller_contact_intake(uuid,text,text,text,text,text,boolean,text,text,text,jsonb,text,text)'::regprocedure);
 needle:=$old$p_consent_version not in ('homeoffer-seller-contact-2026-10-05.2','homeoffer-seller-contact-2026-10-05.3')$old$;
 if position(needle in definition)=0 then raise exception 'Seller consent version check changed';end if;
 definition:=replace(definition,needle,$new$p_consent_version not in ('homeoffer-seller-contact-2026-10-05.2','homeoffer-seller-contact-2026-10-05.3','homeoffer-seller-contact-2026-10-05.4')$new$);
 needle:='begin'||chr(10)||' if email_value';
 if position(needle in definition)=0 then raise exception 'Seller intake entry changed';end if;
 definition:=replace(definition,needle,$new$begin
 if p_consent_version='homeoffer-seller-contact-2026-10-05.4' and p_consented is distinct from true then raise exception 'Contact agreement needed';end if;
 if email_value$new$);
 needle:='state,canonical_id,email,email_consented,contact_consent_scope)';
 if position(needle in definition)=0 then raise exception 'Seller evidence columns changed';end if;
 definition:=replace(definition,needle,'state,canonical_id,owner_claimed,email,email_consented,contact_consent_scope)');
 needle:='canonical,email_value,p_consented and email_value is not null';
 if position(needle in definition)=0 then raise exception 'Seller evidence values changed';end if;
 definition:=replace(definition,needle,$new$canonical,p_consent_version<>'homeoffer-seller-contact-2026-10-05.4',email_value,p_consented and email_value is not null$new$);
 execute definition;
end $patch$;
