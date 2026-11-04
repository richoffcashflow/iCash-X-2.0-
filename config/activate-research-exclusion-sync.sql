-- REVIEW PLAN ONLY. Do not run as a migration or deploy hook.
-- First verify the same reviewed release is live on web and worker, its required
-- checks pass, and inspect the saved provider list's identity/readiness. Set these
-- transaction-local values to the ACTUAL reviewed values in the same transaction:
--   set local icash.reviewed_release_sha = '<40-character release SHA>';
--   set local icash.reviewed_exclusion_list_id = '<exact existing provider list ID>';
-- The SHA is an operator attestation; this SQL does not query deployment hosts.
-- This plan enables only free ordinary-capacity list synchronization. It does
-- not enable query exclusion policy, attach lists, enable targeting, or backfill.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $activate$
declare expected text:=current_setting('icash.reviewed_exclusion_list_id',true);
 release text:=current_setting('icash.reviewed_release_sha',true);
 settings icash_research_private.settings; saved icash_research_private.exclusions;
begin
 if coalesce(release,'')!~'^[a-f0-9]{40}$' or coalesce(expected,'')!~'^[A-Za-z0-9_-]{1,100}$' then
  raise exception 'Reviewed release and exact existing list are required';
 end if;
 if md5(pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure))<>'d501cff48bc2a47fc079ad6d1ece47d3' then
  raise exception 'Reviewed sync claim changed';
 end if;
 select * into settings from icash_research_private.settings where id=1 for update;
 if not found or not settings.enabled or settings.exclusions_enabled or settings.exclusion_sync_enabled then
  raise exception 'Expected inactive independent sync and disabled query exclusion policy';
 end if;
 select * into saved from icash_research_private.exclusions where id=1 for update;
 if not found or saved.list_id is distinct from expected or saved.state<>'ready'
  or saved.token is not null or saved.lease_until is not null or cardinality(saved.batch)<>0 then
  raise exception 'Exact ready idle provider list required';
 end if;
 update icash_research_private.settings set exclusion_sync_enabled=true where id=1;
end $activate$;
select exclusions_enabled,exclusion_sync_enabled from icash_research_private.settings where id=1;
commit;
