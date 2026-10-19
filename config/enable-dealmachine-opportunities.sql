-- Apply only after the opportunity-engine app and worker release is healthy.
-- Owner instruction 2026-10-19: activate DealMachine research and seller outreach.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.icash_settle_dealmachine_usage(text)') is null
  or to_regprocedure('public.icash_pending_opportunity_count(uuid)') is null
  or not exists(select 1 from public.icash_operating_budget where id=1 and enabled and standard_cost_multiplier=2 and elevenlabs_cost_multiplier=2)
 then raise exception 'Opportunity release and unchanged other pricing required';end if;
end $$;
update public.icash_acquisition_policy set mode='hybrid',updated_at=now() where id=1;
update public.icash_discovery_configs set interval_seconds=60,next_run_at=least(next_run_at,now())
 where enabled and auto_enabled and data_rights_until>now();
-- Renew the enabled provider-source configuration within the already approved
-- data-rights window. Never alter or backdate a recipient observation, consent,
-- opt-out, lookup timestamp, or the 24-hour freshness requirement.
update public.icash_dnc_verification_sources set expires_at=greatest(expires_at,
 (select max(data_rights_until) from public.icash_discovery_configs where enabled and auto_enabled and data_rights_until>now()))
 where enabled and observation_provider='dealmachine' and evidence_kind='national_provider_observation'
  and observation_scope='national_only' and max_observation_age_seconds=86400
  and source_reference='https://api.docs.dealmachine.com/concepts/response-format#phones';
commit;
