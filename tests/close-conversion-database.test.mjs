import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const configs=['config/close-call-capacity.sql','config/close-buyer-demand.sql','config/close-deal-recovery.sql'];
const combined='begin;\n'+configs.map(path=>readFileSync(path,'utf8').replace('begin;\n','').replace(/commit;\s*$/,'').trimEnd()).join('\n\n')+'\ncommit;\n';
assert.equal(readFileSync('supabase/migrations/20261023031149_close_conversion_upgrades.sql','utf8'),combined,'single atomic release matches the tested SQL');
const modulePath=fileURLToPath(import.meta.resolve('@electric-sql/pglite'));
for(const file of ['tests/tiered-assignment-pricing-database.mjs','scripts/test-buyer-network-pglite.mjs']){
 const r=spawnSync(process.execPath,['--experimental-strip-types',file,modulePath],{encoding:'utf8',timeout:55000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);process.stdout.write(r.stdout);
}
