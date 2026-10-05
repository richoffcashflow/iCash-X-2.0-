begin;
-- Change future introductions only; retain the deployed admission and billing logic.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 needle:='principal text;address text;';
 if position(needle in definition)=0 then raise exception 'SMS identity declaration changed';end if;
 definition:=replace(definition,needle,'principal text;buyer_description text;address text;');
 needle:='select trim(i.principal) into principal from public.icash_customer_identities i where i.account_id=p_account;';
 if position(needle in definition)=0 then raise exception 'SMS identity lookup changed';end if;
 definition:=replace(definition,needle,$new$select trim(i.principal),case when nullif(trim(i.company_name),'') is null then 'an individual HomeOffer Network investor' else 'an independent HomeOffer Network cash buyer' end into principal,buyer_description from public.icash_customer_identities i where i.account_id=p_account;$new$);
 needle:=$old$message_body:=greeting||'I am the AI assistant for '||principal||'. Is this the owner of '||address||'? Reply STOP to opt out.';$old$;
 if position(needle in definition)=0 then raise exception 'SMS opening changed';end if;
 definition:=replace(definition,needle,$new$message_body:=greeting||'AI for '||principal||', '||buyer_description||'. Is this the owner of '||address||'? Reply STOP to opt out.';$new$);
 execute definition;
end $patch$;
commit;
