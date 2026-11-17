-- The reporting result already requires this exact configuration/rate check.
-- Avoid complete candidate ranking when it cannot produce research work.
-- Keep all post-selection source and current-control checks unchanged.
-- The release runner owns the transaction and migration-ledger entry.
set local lock_timeout='2s';
set local statement_timeout='8s';
set local search_path='';
do $patch$
declare before_definition text;after_definition text;actual record;
 needle text:=E' if work is null then\n  candidate:=public.icash_enrichment_candidate(p_account);';
 replacement text:=$replacement$ if work is null and exists(select 1 from public.icash_discovery_configs c
  join public.icash_operation_rates r on r.id=c.contact_rate_id and r.operation='owner_enrichment'
   and r.enabled and r.verified_at<=now() and r.expires_at>now()
  where c.account_id=p_account and c.enabled and c.auto_enabled and c.contacts_enabled and c.data_rights_until>now()) then
  candidate:=public.icash_enrichment_candidate(p_account);$replacement$;
begin
 -- Ordinary lane polls frequently own this transaction lock. Wait only within
 -- the existing two-second lock and eight-second DO statement bounds above.
 perform pg_advisory_xact_lock(726341927);
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
  where p.oid=to_regprocedure('public.icash_usage_loop_context(uuid,uuid)');
 if not found or md5(actual.definition) is distinct from '846e7e4dec84578b511ec69f62a23222'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef
  or actual.provolatile::text is distinct from 'v' or actual.proparallel::text is distinct from 'u'
  or actual.proisstrict or actual.proleakproof or actual.proconfig is distinct from array['search_path=""']::text[]
  or actual.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
  raise exception 'Usage research precheck source or metadata changed';end if;
 before_definition:=actual.definition;
 if (length(before_definition)-length(replace(before_definition,needle,'')))<>length(needle) then
  raise exception 'Usage research precheck selection boundary changed';end if;
 execute replace(before_definition,needle,replacement);
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
  where p.oid=to_regprocedure('public.icash_usage_loop_context(uuid,uuid)');
 after_definition:=replace(before_definition,needle,replacement);
 if actual.definition is distinct from after_definition or md5(actual.definition) is distinct from 'fc24c125163489d40d275e0b158b6455'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef
  or actual.provolatile::text is distinct from 'v' or actual.proparallel::text is distinct from 'u'
  or actual.proisstrict or actual.proleakproof or actual.proconfig is distinct from array['search_path=""']::text[]
  or actual.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
  raise exception 'Usage research precheck result or metadata changed';end if;
end $patch$;
