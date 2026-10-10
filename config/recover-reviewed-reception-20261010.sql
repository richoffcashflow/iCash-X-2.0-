-- One-time reviewed recovery of the existing v11 inbound configuration.
-- Full redacted provider settings were reviewed on October 10, 2026.
-- This is a NEW approval of exact settings, not proof that the old raw JSON was
-- identical. Preserve the old immutable approval and all failed voice evidence.
-- No provider writes, paid tests, candidate activation or pricing changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
do $recover$
declare
 report public.icash_integration_checks;
 prior public.icash_integration_checks;
 c icash_recorded_reception_private.configs;
 n icash_recorded_reception_private.configs;
 audit jsonb;
 source_snapshot jsonb;
 receipt jsonb;
 reviewed_hash constant text := '14d93cf8d37009f0b5890ec01708a831935033014ac2605e763791df51df9ae6';
 source_hash constant text := 'b1a4c75ebac9890933189d3b98f68c34774e9cbbd79b72a62756c70e3ebcc060';
 report_marker constant text := 'reception_config_review_20261010_14d93cf8d370';
 recovery_marker constant text := 'reception_config_recovery_20261010';
begin
 select * into report from public.icash_integration_checks where provider=report_marker for update;
 if not found or report.result->>'status' is distinct from 'needs_review'
  or report.result->>'sourceConfigHash' is distinct from source_hash
  or report.result->>'observedHash' is distinct from reviewed_hash
  or report.result->'providerWrites' is distinct from 'false'::jsonb
  or report.result->'calls' is distinct from 'false'::jsonb
  or report.result->'checks' is distinct from '{"audio":true,"noRag":true,"branch":true,"noData":true,"target":true,"noTools":true,"identity":true,"exactStop":true,"exactPrompt":true,"noCustomLlm":true,"noRecording":true,"boundedQueue":true,"noMcpServers":true,"noProcedures":true,"privateAgent":true,"safeBuiltins":true,"contextPolicy":true,"inertWorkflow":true,"noLegacyQueue":true,"promptMatches":true,"responseModel":true,"exactAgreement":true,"separateBranch":true,"boundedDuration":true,"greetingMatches":true,"noKnowledgeBase":true,"safeInlineTools":true,"durationOverride":true,"noPostcallExport":true,"priceEnforcement":true,"noExternalToolIds":true,"noLanguagePresets":true,"disclosedReception":true,"noLegacyInitiation":true,"finiteResponseTokens":true,"buyerOpeningValidation":true,"sharedBurstingDisabled":true,"workspacePostcallAbsent":true,"boundedProviderConcurrency":true,"noClientExecutionOverrides":true,"inlineStopMatchesReviewedDefinition":true}'::jsonb then
  raise exception 'Exact complete reviewed configuration report required';
 end if;

 select * into c from icash_recorded_reception_private.configs
 where id=(report.result->>'sourceConfigId')::uuid for update;
 if not found or c.config_hash<>source_hash or c.context_policy<>'automatic_offer_v11'
  or c.context_policy_hash<>'2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a'
  or c.agent_id<>'agent_7801m3qsygdwfv5tggatf7w68y3d'
  or c.branch_id<>'agtbrch_8101m4h801smere91ege6f978hc7'
  or c.version_id<>'agtvrsn_7001m4h801skee292g590meg3yg0'
  or report.result->>'versionId' is distinct from c.version_id
  or report.result#>>'{configuration,agent_id}' is distinct from c.agent_id
  or report.result#>>'{configuration,branch_id}' is distinct from c.branch_id
  or report.result#>>'{configuration,version_id}' is distinct from c.version_id then
  raise exception 'Reviewed existing v11 source required';
 end if;
 source_snapshot:=to_jsonb(c)-'enabled';

 select result into audit from public.icash_integration_checks
 where provider='buyer_scenario_audit_20261009_v7' for share;
 if audit->>'status' is distinct from 'failed'
  or audit->>'code' is distinct from 'BUYER_SCENARIO_FAILURES_REQUIRE_FIX'
  or audit->>'fixtureHash' is distinct from 'd122040ff176d09d208e77fafdc7c67f5c42024d0118ce5d76221feff1b988e0'
  or audit->'count' is distinct from '30'::jsonb
  or jsonb_array_length(audit->'tests') is distinct from 30 then
  raise exception 'Failed voice audit must remain recorded';
 end if;

 select * into prior from public.icash_integration_checks where provider=recovery_marker for update;
 if found then
  select * into n from icash_recorded_reception_private.configs where id=(prior.result->>'configId')::uuid;
  if not found or not n.enabled or n.config_hash<>reviewed_hash or c.enabled
   or prior.result->>'status' is distinct from 'reviewed'
   or prior.result->>'sourceConfigId' is distinct from c.id::text
   or prior.result->>'reviewReport' is distinct from report_marker then
   raise exception 'Recovery receipt no longer matches active configuration';
  end if;
  return;
 end if;
 if not c.enabled or report.checked_at<now()-interval '2 hours'
  or report.checked_at>now() or c.reviewed_until<now()+interval '15 minutes'
  or c.max_total_seconds<>600 or c.max_concurrent_calls<>1
  or c.charge_cap_cents<>408 or c.caller_max_calls<>5 or c.caller_window_seconds<>60 then
  raise exception 'Current reviewed source and unchanged operating limits required';
 end if;
 if public.icash_buyer_outreach_held(c.account_id,'f50f5183-9b83-4cb3-b099-76f246e7ac9b') is distinct from true then
  raise exception 'Existing buyer outreach hold required';
 end if;

 -- Same lock ordering used by call admission and the immutable config guard.
 perform 1 from icash_reception_private.config where id=1 for update;
 if not found or exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then
  raise exception 'Reception must be drained before switching approvals';
 end if;
 n:=c;
 n.id:=gen_random_uuid();
 n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.config_hash:=reviewed_hash;
 n.enabled:=false;
 n.created_at:=icash_recorded_reception_private.clock_now();
 n.approved_at:=n.created_at;
 n.approval_reference:='Owner requested repair and shipping October 10, 2026. New approval following complete private provider configuration review '||report_marker||'. All 41 exact policy/tool/identity/bounds checks passed; complete additional settings reviewed. Prior raw snapshot unavailable, so equivalence is not asserted. Preserve source '||c.id::text||', v11 policy, branch/version, rates, expiry, operating limits, outreach hold and failed scenario evidence. No paid tests or provider mutations authorized.';
 if (to_jsonb(n)-array['id','version','config_hash','enabled','created_at','approved_at','approval_reference'])
  is distinct from (to_jsonb(c)-array['id','version','config_hash','enabled','created_at','approved_at','approval_reference']) then
  raise exception 'Recovery may not alter policy, pricing, limits, validity or provider identity';
 end if;
 -- The existing guard validates the unchanged cost policy and rate snapshots.
 insert into icash_recorded_reception_private.configs select n.*;
 update icash_recorded_reception_private.configs set enabled=false where id=c.id;
 update icash_recorded_reception_private.configs set enabled=true where id=n.id;
 if (select to_jsonb(old)-'enabled' from icash_recorded_reception_private.configs old where id=c.id)
  is distinct from source_snapshot
  or (select result from public.icash_integration_checks where provider='buyer_scenario_audit_20261009_v7') is distinct from audit then
  raise exception 'Historical approvals and failed evidence must be preserved';
 end if;
 receipt:=jsonb_build_object('status','reviewed','scope','existing_v11_configuration_recovery',
  'configId',n.id,'configHash',reviewed_hash,'sourceConfigId',c.id,'sourceConfigHash',source_hash,
  'reviewReport',report_marker,'approvedAt',n.approved_at,'reviewedUntil',n.reviewed_until,
  'agentId',n.agent_id,'branchId',n.branch_id,'versionId',n.version_id,
  'limitsUnchanged',true,'providerWrites',false,'calls',false,'paidTests',false,
  'candidateActivationAllowed',false,'failedVoiceAuditPreserved','buyer_scenario_audit_20261009_v7',
  'rawSnapshotEquivalenceClaimed',false);
 insert into public.icash_integration_checks(provider,checked_at,result) values(recovery_marker,now(),receipt);
end $recover$;
commit;
select result from public.icash_integration_checks where provider='reception_config_recovery_20261010';

