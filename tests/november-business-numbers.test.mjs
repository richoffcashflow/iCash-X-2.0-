import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
for(const name of ['november_business_numbers','november_sender_pacing','november_additional_business_numbers','november_additional_sender_pacing']){
 const file=readdirSync('supabase/migrations').find(p=>p.endsWith('_'+name+'.sql'));
 assert.equal(readFileSync('supabase/migrations/'+file,'utf8'),readFileSync('config/'+name.replaceAll('_','-')+'.sql','utf8'));
}
const run=spawnSync(process.execPath,['--experimental-strip-types','tests/balanced-business-number-routing.test.mjs'],{
 env:{...process.env,VERIFIED_OUTBOUND_NUMBERS_ONLY:'1',NOVEMBER_NUMBERS_ONLY:'1'},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/PASS November numbers/);console.log(run.stdout.trim());
