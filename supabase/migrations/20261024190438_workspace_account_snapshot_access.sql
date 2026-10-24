begin;
set local lock_timeout='5s';
-- Keep the verified account, paid access and acknowledgment in one server-only
-- response. Funding claims and all account/work admission rules stay unchanged.
do $$
declare definition text; replacement text;
 previous constant text:='return jsonb_build_object(''accountId'',a.id,''account'',result);';
 next_return constant text:=$return$return jsonb_build_object('accountId',a.id,'account',result,
  'access',public.icash_workspace_vip_access(a.id),
  'workspaceAcknowledgment',jsonb_build_object(
   'workspace_ack_version',a.workspace_ack_version,
   'workspace_ack_user_id',a.workspace_ack_user_id,
   'workspace_ack_hash',a.workspace_ack_hash));$return$;
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p
 where p.oid='public.icash_load_workspace_account(uuid,text)'::regprocedure and not p.prosecdef;
 if definition is null or position(previous in definition)=0
  or (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1
  or position('select * into strict a from public.icash_accounts where id=account_id and owner_user_id=p_user;' in definition)=0
  or position('''workspaceAcknowledgment''' in definition)>0 then
  raise exception 'Unexpected workspace account snapshot';
 end if;
 replacement:=replace(definition,previous,next_return);
 if replace(replacement,next_return,previous)<>definition then raise exception 'Unexpected workspace snapshot replacement';end if;
 -- CREATE OR REPLACE retains the current private grants and invoker security.
 execute replacement;
end $$;
commit;
