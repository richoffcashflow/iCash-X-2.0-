import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assertOwnerDemoRestartParity} from './helpers/owner-demo-restart-parity.mjs';
assertOwnerDemoRestartParity('owner-demo-confirmed-sender');
const run=spawnSync(process.execPath,['--experimental-strip-types','tests/balanced-business-number-routing.test.mjs'],{
 env:{...process.env,VERIFIED_OUTBOUND_NUMBERS_ONLY:'1',NOVEMBER_NUMBERS_ONLY:'1',OWNER_DEMO_ROUTING_ONLY:'1',OWNER_DEMO_CONFIRMED_SENDER_ONLY:'1'},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/PASS owner demo confirmed sender/);console.log(run.stdout.trim());
