import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=spawnSync(process.execPath,['--experimental-strip-types','tests/balanced-business-number-routing.test.mjs'],{
 env:{...process.env,VERIFIED_OUTBOUND_NUMBERS_ONLY:'1',NOVEMBER_NUMBERS_ONLY:'1',SENDER_HEALTH_ROUTING:'1'},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/PASS sender health routing/);console.log(run.stdout.trim());
