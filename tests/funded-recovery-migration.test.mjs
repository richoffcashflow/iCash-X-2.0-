import {readFileSync} from 'node:fs';
import {assertMigrationConfig} from './helpers/funded-recovery-migration.mjs';
for(const name of ['research-quota-monitoring','identity-bound-opportunity-buffer']){
 assertMigrationConfig(name,readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8'));
}
console.log('PASS atomic funded recovery migration preserves both remaining reviewed configurations.');
