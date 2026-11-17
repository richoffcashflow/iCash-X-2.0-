-- A journey selection is not a provider attempt. Reuse the original ready
-- message after a preflight hold; dispatching/unknown receipts remain held.
-- No existing review state, message, receipt, operation or attempt is reset.
-- The migration runner owns the transaction, including its ledger insertion.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $patch$
declare
 target regprocedure:='public.icash_claim_journey_message()'::regprocedure;
 definition text; original_owner oid; original_acl aclitem[];
 needle text:=E' if m.attempts>=3 then update public.icash_journey_messages set state=''needs_review'' where id=m.id;return null;end if;\n';
 binding text:='where id=m.message_id and account_id=m.account_id;';
 receipt text:='if x.state<>''ready'' or x.provider_id is not null';
begin
 select pg_get_functiondef(oid),proowner,proacl into definition,original_owner,original_acl from pg_proc where oid=target;
 -- Pin the installed predecessor, including invoker/volatility/search_path.
 if md5(definition)<>'a7dddbab7991f436420991832688f09a'
  or pg_get_userbyid(original_owner)<>'postgres'
  or original_acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
 then raise exception 'Journey message preflight prerequisite changed';end if;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle)
  or (length(definition)-length(replace(definition,binding,'')))<>length(binding)
  or (length(definition)-length(replace(definition,receipt,'')))<>length(receipt)
 then raise exception 'Journey message preflight retry boundary changed';end if;
 definition:=replace(definition,needle,'');
 definition:=replace(definition,binding,'where id=m.message_id and account_id=m.account_id and thread_id=m.thread_id;');
 -- A missing/misbound original cannot qualify as never dispatched merely
 -- because SQL NULL comparisons do not enter the existing receipt hold.
 execute replace(definition,receipt,'if not found or x.state<>''ready'' or x.provider_id is not null');
 if not exists(select 1 from pg_proc where oid=target
  and proowner=original_owner and proacl is not distinct from original_acl
  and md5(pg_get_functiondef(oid))='20ccd9d013a36491533cb033e218067c')
 then raise exception 'Journey message preflight replacement changed';end if;
end $patch$;
