import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Preserve exact installed sources. The minimum-capacity diagnostic is a
// separate guarded follow-up, never a rewrite of the installed monitor.
export const fundedRecoveryMigrations={
 'recorded-reception-identity-backoff':'20261103162508_recorded_reception_identity_backoff.sql',
 'seller-opener-bounded-scan':'20261103162517_seller_opener_bounded_scan.sql',
 'seller-opener-literal-ampersand':'20261103181852_seller_opener_literal_ampersand.sql',
 'text-receipt-queue-fairness':'20261103181900_text_receipt_queue_fairness.sql',
 'owner-retry-fair-priority':'20261103181911_owner_retry_fair_priority.sql',
 'owner-preflight-list-indexing':'20261103182413_owner_preflight_list_indexing.sql',
 'owner-preflight-quota-recovery':'20261103182541_owner_preflight_quota_recovery.sql',
 'research-quota-monitoring':'20261103183354_research_quota_monitoring.sql',
 'identity-bound-opportunity-buffer':'20261103183400_identity_bound_opportunity_buffer.sql',
 'research-quota-minimum-capacity':'20261103183653_research_quota_minimum_capacity.sql',
 'urgent-voice-source-gate':'20261103184920_urgent_voice_source_gate.sql',
 'voice-global-contact-index':'20261103190835_voice_global_contact_index.sql',
 'legacy-voice-candidate-fence':'20261103191344_legacy_voice_candidate_fence.sql',
 'ordinary-voice-phone-fence':'20261103204619_ordinary_voice_phone_fence.sql',
 'seller-opener-literal-address-copy':'20261103204625_seller_opener_literal_address_copy.sql',
};
export function assertMigrationConfig(name,source){
 assert.ok(Object.hasOwn(fundedRecoveryMigrations,name),'Known independently deployable recovery step');
 const migration=readFileSync(new URL('../../supabase/migrations/'+fundedRecoveryMigrations[name],import.meta.url),'utf8');
 assert.equal(migration,source,'Migration retains the exact reviewed configuration including its transaction');
}
