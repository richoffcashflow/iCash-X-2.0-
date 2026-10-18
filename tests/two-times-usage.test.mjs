// Replay the connected billing paths locally. No external providers or wallets.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),pglite=fileURLToPath(import.meta.resolve('@electric-sql/pglite'));
for(const [script,env] of [
 ['tests/customer-phone-recording-database.mjs',{}],
 ['scripts/test-sms-ai-token-billing-pglite.mjs',{}],
 ['scripts/test-flexible-voice-credits-pglite.mjs',{}],
 ['scripts/test-recorded-reception-pglite.mjs',{RECEPTION_FLEXIBLE_ONLY:'1',RECEPTION_DIRECT_ONLY:'1',RECEPTION_AVAILABLE_CREDITS:'1'}],
]){
 const r=spawnSync(process.execPath,['--experimental-strip-types',script,pglite],{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout:20000});
 if(r.error||r.status!==0)console.error(script,r.error,r.stdout,r.stderr);
 assert.equal(r.status,0,script);console.log(r.stdout.trim());
}
