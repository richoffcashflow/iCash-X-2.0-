-- Whole-message requests to pause the seller discussion use existing soft holds.
-- No historical source replay, global suppression, new permission or provider action.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $patch$
declare f record;d text;old text:=' decline_body:=case when b ~';
begin
 for f in select * from (values
  ('public.icash_seller_response_disposition(text)','8e47d476f60a9e74fa6f2a6c460efdb8'),
  ('public.icash_seller_direct_response_match(text,text)','bab353cb54bf841c9c9d3e19c1a8277f'),
  ('public.icash_seller_contact_stop(text)','45076f5ffc443238ddf92cc79c1a10ba'),
  ('public.icash_seller_hard_stop(text)','f43428ed584e281c0e02ea537b83d55d')
 ) expected(signature,source_md5) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(f.signature)
   and md5(pg_get_functiondef(p.oid))=f.source_md5 and pg_get_userbyid(p.proowner)='postgres'
   and p.provolatile='i' and not p.prosecdef and p.proconfig=array['search_path=""']
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
   and has_function_privilege('service_role',p.oid,'EXECUTE')
   and not has_function_privilege('anon',p.oid,'EXECUTE')
   and not has_function_privilege('authenticated',p.oid,'EXECUTE')) then
   raise exception 'Seller pause source or authority changed: %',f.signature;
  end if;
 end loop;
 d:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Seller pause insertion changed';end if;
 execute replace(d,old,$new$ if public.icash_seller_direct_response_match(b,$pattern$^(?:(?:ok(?:ay)?|yes)[, ]+)?(?:please )?pause(?: here)?(?: for now)?(?: please)?[.! ,]*$$pattern$) then return 'review';end if;
 decline_body:=case when b ~$new$);
 if md5(pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure))<>'81b691c8440429fa9c7f057cf70306bf' then
  raise exception 'Seller pause result source changed';
 end if;
end $patch$;
