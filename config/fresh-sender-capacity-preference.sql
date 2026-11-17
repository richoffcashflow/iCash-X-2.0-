-- Prefer current cold capacity only for a future first SMS allocation.
-- Established identities, route history, final admission and all limits survive.
-- The migration runner owns the transaction and matching history entry.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $patch$
declare source text;needle text;before_acl aclitem[];before_owner oid;
begin
 select pg_get_functiondef(p.oid),p.proacl,p.proowner into strict source,before_acl,before_owner
 from pg_proc p where p.oid='public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure
 and p.provolatile='s' and not p.prosecdef and p.proconfig=array['search_path=""'];
 if md5(source)<>'6d502484d3cd54f65d165e4a15f0497b'
  or before_acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
  or to_regprocedure('icash_sender_private.room(text,boolean,uuid,text)') is null
 then raise exception 'Fresh sender capacity prerequisite changed';end if;
 needle:='existing_identity boolean;chosen text;';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Sender identity declaration changed';end if;
 source:=replace(source,needle,'existing_identity boolean;prefer_capacity boolean:=false;chosen text;');
 needle:=' existing_identity:=chosen is not null;';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Sender identity boundary changed';end if;
 source:=replace(source,needle,needle||$new$
 -- This is ordering for a wholly new recipient route, never a route repair.
 -- Even an orphan saved route or a retired exact thread keeps its old order.
 prefer_capacity:=not p_voice and not existing_identity
  and not exists(select 1 from public.icash_sms_routes route where route.recipient=p_recipient)
  and not exists(select 1 from public.icash_non_test_text_threads prior
   join public.icash_deal_files d on d.id=prior.deal_id and d.account_id=prior.account_id
   where prior.account_id=p_account and d.screening_id=p_screening and prior.recipient=p_recipient);
$new$);
 needle:=$old$ order by encode(sha256(convert_to(p_account::text||':'||p_screening::text||':'||p_recipient||':'||s.phone,'UTF8')),'hex'),s.phone$old$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Sender deterministic order changed';end if;
 source:=replace(source,needle,$new$ order by case when prefer_capacity then case when icash_sender_private.room(s.phone,true) then 0 else 1 end else 0 end,
  encode(sha256(convert_to(p_account::text||':'||p_screening::text||':'||p_recipient||':'||s.phone,'UTF8')),'hex'),s.phone$new$);
 execute source;
 if not exists(select 1 from pg_proc p where p.oid='public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure
  and p.provolatile='s' and not p.prosecdef and p.proconfig=array['search_path=""']
  and p.proacl is not distinct from before_acl and p.proowner=before_owner
  and md5(pg_get_functiondef(p.oid))=md5(source))
 then raise exception 'Fresh sender capacity postcondition failed';end if;
end $patch$;
