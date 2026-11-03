import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Preserve exact installed sources. The minimum-capacity diagnostic is a
// separate guarded follow-up, never a rewrite of the installed monitor.
export const fundedRecoveryMigrations={
 'owner-preflight-list-indexing':'20261103182413_owner_preflight_list_indexing.sql',
 'owner-preflight-quota-recovery':'20261103182541_owner_preflight_quota_recovery.sql',
 'research-quota-monitoring':'20261103183354_research_quota_monitoring.sql',
 'identity-bound-opportunity-buffer':'20261103183400_identity_bound_opportunity_buffer.sql',
 'research-quota-minimum-capacity':'20261103183653_research_quota_minimum_capacity.sql',
};
export function assertMigrationConfig(name,source){
 assert.ok(Object.hasOwn(fundedRecoveryMigrations,name),'Known independently deployable recovery step');
 const migration=readFileSync(new URL('../../supabase/migrations/'+fundedRecoveryMigrations[name],import.meta.url),'utf8');
 assert.equal(migration,source,'Migration retains the exact reviewed configuration including its transaction');
}
