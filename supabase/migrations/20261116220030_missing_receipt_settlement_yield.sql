-- Missing original research receipts remain held without taking the shared
-- budget row. Receipt-present work retains the complete locked settlement.
-- The runner owns the migration and schema-history transaction.
set local lock_timeout='3s';
set local statement_timeout='15s';
do $patch$
declare definition text;expected_definition text;installed_definition text;before_metadata jsonb;after_metadata jsonb;
 boundary text:=E'begin\n perform 1 from public.icash_operating_budget where id=1 for update;';
 replacement text:=$replacement$begin
 -- Absence only defers this original until normal recovery sees its receipt.
 -- Never infer zero cost or release a hold from missing provider evidence.
 if exists(select 1 from public.icash_operation_spend pending
  join public.icash_operation_rates rate on rate.id=pending.rate_id
  where pending.operation_key=p_operation and pending.state='dispatched'
   and case rate.operation
    when 'property_search' then not exists(select 1 from public.icash_discovery_results receipt
     where receipt.operation_key=pending.operation_key and receipt.account_id=pending.account_id)
    when 'owner_enrichment' then not exists(select 1 from public.icash_owner_contacts receipt
     where receipt.operation_key=pending.operation_key and receipt.account_id=pending.account_id)
    when 'buyer_discovery' then not exists(select 1 from public.icash_buyer_search_receipts receipt
     join public.icash_deal_files deal on deal.id=receipt.deal_id and deal.account_id=pending.account_id
     where receipt.operation_key=pending.operation_key)
    else false end) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;$replacement$;
begin
 perform pg_advisory_xact_lock(726341927);
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,before_metadata
 from pg_proc p where p.oid='public.icash_settle_estimate_before_sms_tokens(text)'::regprocedure;
 if md5(definition)<>'d463afb80ef551b673a1f7c43710117f'
  or md5(pg_get_functiondef('public.icash_settle_dealmachine_usage(text)'::regprocedure))<>'a3ffd9bc1ecd0eab2c1eff5a59727ea9'
 then raise exception 'Missing receipt settlement predecessor changed';end if;
 if not exists(select 1 from pg_proc p where p.oid='public.icash_settle_estimate_before_sms_tokens(text)'::regprocedure
   and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='v' and p.proparallel='u'
   and not p.proleakproof and not p.proisstrict and p.proconfig=array['search_path=""'])
  or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.oid='public.icash_settle_estimate_before_sms_tokens(text)'::regprocedure
    and (a.grantee not in ('postgres'::regrole,'service_role'::regrole)
     or a.grantor<>'postgres'::regrole or a.privilege_type<>'EXECUTE' or a.is_grantable))
  or not has_function_privilege('service_role','public.icash_settle_estimate_before_sms_tokens(text)','EXECUTE')
  or has_function_privilege('anon','public.icash_settle_estimate_before_sms_tokens(text)','EXECUTE')
  or has_function_privilege('authenticated','public.icash_settle_estimate_before_sms_tokens(text)','EXECUTE')
 then raise exception 'Missing receipt settlement privileges changed';end if;
 if (length(definition)-length(replace(definition,boundary,'')))<>length(boundary) then
  raise exception 'Missing receipt settlement boundary changed';end if;
 expected_definition:=replace(definition,boundary,replacement);
 execute expected_definition;
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into installed_definition,after_metadata
 from pg_proc p where p.oid='public.icash_settle_estimate_before_sms_tokens(text)'::regprocedure;
 if installed_definition is distinct from expected_definition or after_metadata is distinct from before_metadata then
  raise exception 'Missing receipt settlement replacement changed';end if;
end $patch$;
