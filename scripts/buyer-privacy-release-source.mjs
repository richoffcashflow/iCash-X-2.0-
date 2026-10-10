// A configuration recovery is a new immutable approval, never a hash bypass.
// The full redacted review remains service-only in icash_integration_checks.
export const receptionRecovery = Object.freeze({
 marker: 'reception_config_recovery_20261010',
 report: 'reception_config_review_20261010_14d93cf8d370',
 sourceId: '036a642a-2683-44b2-be50-52193aea693b',
 sourceHash: 'b1a4c75ebac9890933189d3b98f68c34774e9cbbd79b72a62756c70e3ebcc060',
 reviewedHash: '14d93cf8d37009f0b5890ec01708a831935033014ac2605e763791df51df9ae6',
 agent: 'agent_7801m3qsygdwfv5tggatf7w68y3d',
 branch: 'agtbrch_8101m4h801smere91ege6f978hc7',
 version: 'agtvrsn_7001m4h801skee292g590meg3yg0',
 policyHash: '2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a',
 failedAudit: 'buyer_scenario_audit_20261009_v7',
});

export function assertBuyerPrivacyReleaseSource(c, recovery) {
 const r = receptionRecovery;
 const identity = c?.enabled === true && c.agent_id === r.agent && c.branch_id === r.branch
  && c.version_id === r.version && c.context_policy === 'automatic_offer_v11'
  && c.context_policy_hash === r.policyHash;
 const original = c?.id === r.sourceId && c.config_hash === r.sourceHash;
 const reviewed = c?.id !== r.sourceId && /^[a-f0-9-]{36}$/.test(c?.id ?? '')
  && c.config_hash === r.reviewedHash && recovery?.configId === c.id
  && recovery.status === 'reviewed' && recovery.scope === 'existing_v11_configuration_recovery'
  && recovery.sourceConfigId === r.sourceId && recovery.sourceConfigHash === r.sourceHash
  && recovery.configHash === r.reviewedHash && recovery.reviewReport === r.report
  && recovery.limitsUnchanged === true && recovery.providerWrites === false
  && recovery.calls === false && recovery.paidTests === false
  && recovery.candidateActivationAllowed === false && recovery.failedVoiceAuditPreserved === r.failedAudit;
 if (!identity || (!original && !reviewed)) throw Error('BUYER_PRIVACY_REVIEWED_ACTIVE_SOURCE_REQUIRED');
 // The caller must still inspect the live provider and compare its raw hash to
 // c.config_hash. This function approves neither drift nor a new voice policy.
}
