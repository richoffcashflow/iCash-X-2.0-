import {readFileSync} from 'node:fs';
import {assertMigrationConfig} from './helpers/funded-recovery-migration.mjs';
for(const name of ['owner-preflight-list-indexing','owner-preflight-quota-recovery','seller-opener-literal-ampersand','text-receipt-queue-fairness','owner-retry-fair-priority','research-quota-monitoring','identity-bound-opportunity-buffer']){
 assertMigrationConfig(name,readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8'));
}
console.log('PASS atomic funded recovery migration preserves all seven reviewed configurations.');
