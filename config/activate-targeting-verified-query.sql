-- REVIEW PLAN ONLY: no deployment hook. Confirm matching web/worker release and
-- native races first; set the ACTUAL reviewed values in this same transaction:
-- set local icash.reviewed_release_sha='<40-character release SHA>';
-- set local icash.reviewed_exclusion_list_id='<exact existing provider list ID>';
-- This arms only the independent exact-list query capability. Experimental
-- definitions/global toggle remain separately controlled by the owner API.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $activate$
declare expected text:=current_setting('icash.reviewed_exclusion_list_id',true);
 release text:=current_setting('icash.reviewed_release_sha',true);
 settings icash_research_private.settings;saved icash_research_private.exclusions;
begin
 if coalesce(release,'')!~'^[a-f0-9]{40}$' or coalesce(expected,'')!~'^[A-Za-z0-9_-]{1,100}$' then raise exception 'Reviewed release and exact existing list required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from icash_research_private.targeting_query_settings where id=1 for update;
 if not found then raise exception 'Verified query migration required';end if;
 select * into settings from icash_research_private.settings where id=1 for share;
 if not found or not settings.enabled or settings.exclusions_enabled or not settings.exclusion_sync_enabled then raise exception 'Independent sync required; old exclusion-query policy must stay off';end if;
 select * into saved from icash_research_private.exclusions where id=1 for share;
 if not found or saved.list_id is distinct from expected or saved.state<>'ready'
  or saved.last_synced_at is null or saved.last_synced_at>now()
  or saved.token is not null or saved.lease_until is not null or coalesce(cardinality(saved.batch),0)<>0
  or exists(select 1 from icash_research_private.exclusion_items where synced_at is null)
  or exists(select 1 from icash_research_private.targeting_acquired_properties where synced_at is null) then raise exception 'Exact idle list and complete original acknowledgments required';end if;
 if exists(select 1 from icash_research_private.targeting_query_settings where enabled) then raise exception 'Query capability already enabled; inspect existing release binding';end if;
 update icash_research_private.targeting_query_settings set enabled=true,list_id=expected,release_sha=release,activated_at=now() where id=1;
end $activate$;
select enabled,list_id,release_sha,activated_at from icash_research_private.targeting_query_settings where id=1;
commit;
