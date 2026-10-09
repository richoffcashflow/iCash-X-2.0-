begin;
-- Presentation only: exact property/recipient routing and stored terms stay unchanged.
create function public.icash_conversation_street(p_address text)
returns text language sql immutable strict security invoker set search_path='' as $$
 select trim(split_part(p_address,',',1))||case
  when trim(split_part(p_address,',',2)) ~* '^(apt\.?|apartment|unit|suite|ste\.?|#)[[:space:]]*[[:alnum:]-]+$'
  then ' '||trim(split_part(p_address,',',2)) else '' end;
$$;
revoke all on function public.icash_conversation_street(text) from public,anon,authenticated;
grant execute on function public.icash_conversation_street(text) to service_role;
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 needle:=$old$address:=trim(d.terms->>'address');$old$;
 if position(needle in definition)=0 then raise exception 'Seller opener address prerequisite changed';end if;
 execute replace(definition,needle,$new$address:=public.icash_conversation_street(d.terms->>'address');$new$);
 definition:=pg_get_functiondef('public.icash_seller_recipient_opener(uuid,uuid,text,text,text)'::regprocedure);
 needle:=$old$ greeting:=case when p_seller$old$;
 if position(needle in definition)=0 then raise exception 'Recipient opener address prerequisite changed';end if;
 execute replace(definition,needle,$new$ p_address:=public.icash_conversation_street(p_address);
 greeting:=case when p_seller$new$);
end $$;
commit;
