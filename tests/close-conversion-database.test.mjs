import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const modulePath=fileURLToPath(import.meta.resolve('@electric-sql/pglite'));
for(const file of ['tests/tiered-assignment-pricing-database.mjs','scripts/test-buyer-network-pglite.mjs']){
 const r=spawnSync(process.execPath,['--experimental-strip-types',file,modulePath],{encoding:'utf8',timeout:55000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);process.stdout.write(r.stdout);
}
