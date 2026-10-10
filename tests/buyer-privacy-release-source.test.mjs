import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBuyerPrivacyReleaseSource, receptionRecovery as r} from '../scripts/buyer-privacy-release-source.mjs';

const source = {id:r.sourceId, enabled:true, config_hash:r.sourceHash, agent_id:r.agent,
 branch_id:r.branch, version_id:r.version, context_policy:'automatic_offer_v11', context_policy_hash:r.policyHash};
const recovered = {...source, id:'11111111-2222-4333-8444-555555555555', config_hash:r.reviewedHash};
const receipt = {status:'reviewed', scope:'existing_v11_configuration_recovery', configId:recovered.id,
 sourceConfigId:r.sourceId, sourceConfigHash:r.sourceHash, configHash:r.reviewedHash, reviewReport:r.report,
 limitsUnchanged:true, providerWrites:false, calls:false, paidTests:false, candidateActivationAllowed:false,
 failedVoiceAuditPreserved:r.failedAudit};

test('an observed hash alone cannot replace an approval', () => {
 assert.doesNotThrow(() => assertBuyerPrivacyReleaseSource(source));
 assert.doesNotThrow(() => assertBuyerPrivacyReleaseSource(recovered,receipt));
 for (const c of [null, {...source,config_hash:r.reviewedHash}, recovered,
  {...recovered,config_hash:'f'.repeat(64)}]) {
  assert.throws(() => assertBuyerPrivacyReleaseSource(c), /REVIEWED_ACTIVE_SOURCE_REQUIRED/);
 }
});

test('replacement approval must bind the exact receipt, policy, agent and version', () => {
 for (const key of Object.keys(receipt)) {
  const altered = {...receipt}; delete altered[key];
  assert.throws(() => assertBuyerPrivacyReleaseSource(recovered,altered), /REVIEWED_ACTIVE_SOURCE_REQUIRED/, key);
 }
 for (const [key,value] of Object.entries({enabled:false, id:source.id, config_hash:'f'.repeat(64),
  agent_id:'another-agent', branch_id:'another-branch', version_id:'another-version',
  context_policy:'automatic_offer_v18', context_policy_hash:'f'.repeat(64)})) {
  assert.throws(() => assertBuyerPrivacyReleaseSource({...recovered,[key]:value},receipt), /REVIEWED_ACTIVE_SOURCE_REQUIRED/,key);
 }
});
