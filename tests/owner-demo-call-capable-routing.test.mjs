import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
const migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_owner_demo_call_capable_routing.sql'));
assert(migration,'CLI migration exists');
assert.equal(readFileSync('supabase/migrations/'+migration,'utf8'),readFileSync('config/owner-demo-call-capable-routing.sql','utf8'));
const run=spawnSync(process.execPath,['--experimental-strip-types','tests/balanced-business-number-routing.test.mjs'],{
 env:{...process.env,VERIFIED_OUTBOUND_NUMBERS_ONLY:'1',NOVEMBER_NUMBERS_ONLY:'1',OWNER_DEMO_ROUTING_ONLY:'1'},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/PASS owner demo call routing/);console.log(run.stdout.trim());
