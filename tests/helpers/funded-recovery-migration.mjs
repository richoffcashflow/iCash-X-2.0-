import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Preserve the exact independently installed preflight migrations. The two
// later changes are separate, unapplied steps, never a replay of installed DDL.
export const fundedRecoveryMigrations={
 'owner-preflight-list-indexing':'20261103182413_owner_preflight_list_indexing.sql',
 'owner-preflight-quota-recovery':'20261103182541_owner_preflight_quota_recovery.sql',
 'research-quota-monitoring':'20261103182800_research_quota_monitoring.sql',
 'identity-bound-opportunity-buffer':'20261103182801_identity_bound_opportunity_buffer.sql',
};
export function assertMigrationConfig(name,source){
 assert.ok(Object.hasOwn(fundedRecoveryMigrations,name),'Known independently deployable recovery step');
 const migration=readFileSync(new URL('../../supabase/migrations/'+fundedRecoveryMigrations[name],import.meta.url),'utf8');
 assert.equal(migration,source,'Migration retains the exact reviewed configuration including its transaction');
}
