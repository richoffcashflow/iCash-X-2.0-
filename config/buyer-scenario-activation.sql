-- Run only after the exact application READY readback and privacy migration.
-- This changes no provider agent, tool, phone number or outbound configuration.
begin;
set local lock_timeout='3s';
do $$
declare audit jsonb;ready jsonb;source icash_recorded_reception_private.configs;candidate icash_recorded_reception_private.configs;
begin
 select result into audit from public.icash_integration_checks where provider='buyer_scenario_audit_20261009_v4';
 select result into ready from public.icash_integration_checks where provider='buyer_scenario_application_ready_20261009_v1';
 if audit->>'status' is distinct from 'passed' or audit->>'count' is distinct from '30' or audit->>'passedCount' is distinct from '30'
  or audit->>'fixtureHash' is distinct from '34dfeb72b8671468924faf1612acaac07d9dce2b773c25552c4444216ed44254'
  or audit->>'policyHash' is distinct from '6fbbe513d434227c54d2b9eff0561d5739bca233dd69e87ca8fd489b057db803'
  or jsonb_array_length(audit->'tests') is distinct from 30
  or exists(select 1 from jsonb_array_elements(audit->'tests') t where t->>'status' is distinct from 'passed' or t->>'branch' is distinct from audit->>'branchId' or t->>'version' is distinct from audit->>'version') then raise exception 'Exact passed scenario audit required';end if;
 if ready->>'state' is distinct from 'READY' or ready->>'commit' is distinct from audit->>'commit'
  or ready->>'deploymentId' is null or ready->>'pricingPrivacyVerified' is distinct from 'true' then raise exception 'Compatible READY application and verified pricing privacy required';end if;
 select * into source from icash_recorded_reception_private.configs where id=(audit->>'sourceConfigId')::uuid for update;
 if not found or not source.enabled or source.context_policy<>'automatic_offer_v11'
  or source.context_policy_hash<>'2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a'
  or source.branch_id is distinct from audit->>'sourceBranchId' or source.version_id is distinct from audit->>'sourceVersion' or source.config_hash is distinct from audit->>'sourceConfigHash' then raise exception 'Reviewed source changed';end if;
 select * into candidate from icash_recorded_reception_private.configs where id=(audit->>'stagedConfigId')::uuid for update;
 if not found or candidate.enabled or candidate.context_policy<>'automatic_offer_v13' or candidate.context_policy_hash<>audit->>'policyHash'
  or candidate.account_id<>source.account_id or candidate.owner_user_id<>source.owner_user_id or candidate.called_number<>source.called_number
  or candidate.agent_id<>source.agent_id or candidate.branch_id=source.branch_id or candidate.version_id=source.version_id
  or candidate.branch_id<>audit->>'branchId' or candidate.version_id<>audit->>'version' or candidate.config_hash<>audit->>'configHash'
  or candidate.config_hash=source.config_hash or candidate.reviewed_until<=now()+interval '15 minutes' then raise exception 'Exact staged candidate required';end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where config_id=source.id and call_ended_at is null and call_deadline_at>now()) then raise exception 'Wait for current inbound calls to finish';end if;
 update icash_recorded_reception_private.configs set enabled=false where id=source.id;
 update icash_recorded_reception_private.configs set enabled=true where id=candidate.id;
 insert into public.icash_integration_checks(provider,checked_at,result) values('buyer_scenario_policy_activation_20261009_v1',now(),jsonb_build_object('status','activated','sourceConfigId',source.id,'configId',candidate.id,'policyHash',candidate.context_policy_hash,'fixtureHash',audit->>'fixtureHash','branchId',candidate.branch_id,'version',candidate.version_id,'configHash',candidate.config_hash,'deploymentId',ready->>'deploymentId','commit',ready->>'commit','outreach',false));
end $$;
commit;
