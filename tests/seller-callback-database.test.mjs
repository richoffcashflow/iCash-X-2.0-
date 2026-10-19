import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
assert.equal(readFileSync('config/seller-callback-routing.sql','utf8'),readFileSync('supabase/migrations/20261019214130_seller_callback_routing.sql','utf8'));
const run=spawnSync(process.execPath,['--experimental-strip-types','scripts/test-recorded-reception-pglite.mjs',new URL('../node_modules/@electric-sql/pglite/dist/index.js',import.meta.url).pathname],{env:{...process.env,RECEPTION_FLEXIBLE_ONLY:'1',RECEPTION_DIRECT_ONLY:'1',RECEPTION_CALLBACK_ONLY:'1'},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
assert.match(run.stdout,/seller callback call receipt routes funded customer/);
assert.match(run.stdout,/seller callback route changes between resolution and reserve are rejected/);
console.log(run.stdout.split('\n').filter(line=>line.includes('seller callback')).join('\n'));
