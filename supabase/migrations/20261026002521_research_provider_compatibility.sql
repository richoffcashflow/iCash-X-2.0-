begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Query v2 removes comparisons against optional numeric lien fields. Observed
-- financially eligible records have NULL open-lien counts/amounts. Old query
-- identities and all actual receipts remain immutable.
alter table public.icash_discovery_configs drop constraint icash_discovery_configs_research_version_check;
alter table public.icash_discovery_configs add constraint icash_discovery_configs_research_version_check check(research_version in (0,1,2));
alter table public.icash_discovery_configs drop constraint icash_discovery_configs_per_page_check;
alter table public.icash_discovery_configs add constraint icash_discovery_configs_per_page_check check(per_page between 1 and case when research_version in (1,2) then 25 else 10 end);

do $$
declare d text;signature text;old text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_prepare_research_efficiency(uuid)'::regprocedure);
 if strpos(d,'row(1,chosen,size,list)')=0 or strpos(d,'set research_version=1,rate_id=chosen')=0 then raise exception 'Research preparation changed';end if;
 d:=replace(d,'row(1,chosen,size,list)','row(2,chosen,size,list)');
 execute replace(d,'set research_version=1,rate_id=chosen','set research_version=2,rate_id=chosen');

 d:=pg_get_functiondef('public.icash_reserve_research_discovery(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 old:='c.research_version is distinct from 1 or p_policy is distinct from jsonb_build_object(''version'',''research-efficiency-v1'',''exclusionListId'',c.research_list_id)';
 replacement:='coalesce(c.research_version,0) not in (1,2) or p_policy is distinct from jsonb_build_object(''version'',case when c.research_version=2 then ''research-efficiency-v2'' else ''research-efficiency-v1'' end,''exclusionListId'',c.research_list_id)';
 if strpos(d,old)=0 then raise exception 'Research query admission changed';end if;
 execute replace(d,old,replacement);

 foreach signature in array array[
  'public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text)',
  'public.icash_prepare_discovery_inventory(uuid,uuid,integer)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if strpos(d,'c.research_version=1')=0 then raise exception 'Research page gate changed: %',signature;end if;
  execute replace(d,'c.research_version=1','c.research_version in (1,2)');
 end loop;

 foreach signature in array array[
  'public.icash_owner_batch_candidates(uuid,uuid)',
  'public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if strpos(d,'c.research_version is distinct from 1')=0 then raise exception 'Owner batch version gate changed: %',signature;end if;
  execute replace(d,'c.research_version is distinct from 1','coalesce(c.research_version,0) not in (1,2)');
 end loop;

 -- Validate all four zero-cost fields, allowing additive provider metadata.
 -- Keep the complete original preview and every property/person association.
 d:=pg_get_functiondef('public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 old:='p_preview->''credits'' is distinct from ''{"used":0,"people":0,"properties":0,"deduplicated":0}''::jsonb';
 replacement:='(p_preview->''credits'' @> ''{"used":0,"people":0,"properties":0,"deduplicated":0}''::jsonb) is distinct from true';
 if strpos(d,old)=0 then raise exception 'Owner preview credit gate changed';end if;
 execute replace(d,old,replacement);
end $$;
commit;
