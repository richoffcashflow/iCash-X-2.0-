import assert from 'node:assert/strict';
import {currentBotActivity} from '../lib/bot-activity.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const now=Date.now(),expires_at=new Date(now+60000).toISOString();
const ticket={kind:'contacts',state:'consumed',expires_at};
assert.equal(currentBotActivity({paused:false,tickets:[ticket],screening:[]},now).label,'Looking up owners');
assert.equal(currentBotActivity({paused:true,tickets:[ticket],screening:[]},now).active,false,'paused takes precedence');
for(const state of ['issued','complete','held'])assert.equal(currentBotActivity({paused:false,tickets:[{...ticket,state}],screening:[]},now).active,false,'unstarted/finished tickets never animate');
assert.equal(currentBotActivity({paused:false,tickets:[{...ticket,expires_at:new Date(now-1).toISOString()}],screening:[]},now).active,false,'expired work never appears live');
assert.equal(currentBotActivity({paused:false,tickets:[{...ticket,kind:'toString'}],screening:[]},now).active,false,'unknown labels are ignored');
assert.equal(currentBotActivity({paused:false,tickets:[],screening:[{state:'running',lease_until:expires_at}]},now).label,'Checking property numbers');
assert.equal(currentBotActivity({paused:false,tickets:[],screening:[{state:'queued',lease_until:expires_at}]},now).label,'Waiting for the next task');
let authorized=true,failed=false,queries=[];
const account='00000000-0000-4000-8000-000000000001';
const route=await loadService('app/api/work/bot-status/route.ts',{
 currentBotActivity,
 NextResponse:{json:(body,options={})=>({body,...options})},
 workAccount:async()=>{if(!authorized)throw Error('SIGN_IN_REQUIRED');return {accountId:account};},
 db:async path=>{
  queries.push(path);if(failed)throw Error('database unavailable');
  assert(path.includes(`eq.${account}`),'all reads are authenticated-account scoped');
  assert(!path.includes('token')&&!path.includes('snapshot')&&!path.includes('result'),'no secrets, property or contact data queried');
  return path.startsWith('icash_accounts?')?[{bot_paused:false}]:path.startsWith('icash_automation_tickets?')?[ticket]:[];
 },
});
let response=await route.GET();assert.equal(response.body.label,'Looking up owners');assert.equal(response.headers['Cache-Control'],'private, no-store');
assert.equal(queries.length,3);authorized=false;queries=[];assert.equal((await route.GET()).status,401);assert.equal(queries.length,0,'no reads without authentication');
authorized=true;failed=true;response=await route.GET();assert.equal(response.status,503);assert(!('active' in response.body),'failure never fabricates work');
console.log('PASS bot activity: actual active tasks, waiting/paused/stale states, tenant scoping, no contact data and authentication');
