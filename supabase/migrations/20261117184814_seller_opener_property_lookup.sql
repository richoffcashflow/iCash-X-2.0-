-- Keep the existing exact account/property control lookup correlated. Without
-- this fence PostgreSQL can scan every control belonging to each account.
-- No source predicate, scan cursor, queue or final admission is changed.
-- The migration runner owns the transaction and migration history.
set local lock_timeout='2s';
set local statement_timeout='8s';
set local search_path='';
do $patch$
declare actual record;before_definition text;after_definition text;
 needle text:='and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>''propertyId'' and pc.manual)';
 replacement text:='and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>''propertyId'' and pc.manual offset 0)';
begin
 perform pg_advisory_xact_lock(726341927);
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
 where p.oid=to_regprocedure('public.icash_next_before_sms_inbound_campaign()');
 if not found or md5(actual.definition) is distinct from 'e6f81c009c46713083f8dc882e6b7d1f'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef
  or actual.provolatile::text is distinct from 'v' or actual.proparallel::text is distinct from 'u'
  or actual.proisstrict or actual.proleakproof or actual.proconfig is distinct from array['search_path=""']::text[]
  or actual.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
  raise exception 'Seller property lookup source or metadata changed';end if;
 before_definition:=actual.definition;
 if (length(before_definition)-length(replace(before_definition,needle,'')))<>2*length(needle) then
  raise exception 'Seller property lookup boundary changed';end if;
 after_definition:=replace(before_definition,needle,replacement);
 execute after_definition;
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
 where p.oid=to_regprocedure('public.icash_next_before_sms_inbound_campaign()');
 if actual.definition is distinct from after_definition or md5(actual.definition) is distinct from '3b84ca1902ff715d3882b8dd6ebba935'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres' or actual.prosecdef
  or actual.provolatile::text is distinct from 'v' or actual.proparallel::text is distinct from 'u'
  or actual.proisstrict or actual.proleakproof or actual.proconfig is distinct from array['search_path=""']::text[]
  or actual.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
  raise exception 'Seller property lookup result or metadata changed';end if;
end $patch$;
