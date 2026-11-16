-- Planner-only relief for account-local seller-call aggregation. Keep the full
-- reviewed function, its result rules, side effects and catalog settings intact.
-- The migration runner owns the transaction and schema-history commit.
set local lock_timeout='5s';
set local statement_timeout='8s';
do $planning$
declare original text; replacement text;
begin
 if not exists(select 1 from pg_catalog.pg_proc
  where oid=to_regprocedure('public.icash_refresh_seller_call_learning(uuid)')
   and md5(prosrc)='6ee6a2f43a5fb1acbc8b3659482e6f8e') then
  raise exception 'Reviewed seller-call learning source required';
 end if;
 if not exists(select 1 from pg_catalog.pg_proc
  where oid=to_regprocedure('icash_learning_private.seller_contact_window_costs(uuid,text,timestamp with time zone,timestamp with time zone)')
   and md5(prosrc)='97c959ed0711576b036c22d41308c12e') then
  raise exception 'Reviewed seller-contact cost source required';
 end if;
 original:=pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure);
 replacement:=replace(original,'with properties as materialized (','with properties as not materialized (');
 if replacement=original or length(replacement)-length(original)<>4 then
  raise exception 'Expected exactly one properties planning clause';
 end if;
 execute replacement;
end $planning$;

-- Match the existing helper's entire eligible-voice predicate. In particular,
-- provider-only, empty-but-non-null SID and dispatching rows remain included.
-- The source SQL and its account/property joins are deliberately unchanged.
create index icash_learning_voice_cost_sources
 on public.icash_voice_jobs(account_id,permission_id,operational_contact_id)
 include(id,operation_key,created_at)
 where operation_key is not null or provider_call_sid is not null
  or state in ('dispatching','dispatched');
