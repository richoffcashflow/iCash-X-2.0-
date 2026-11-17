import assert from 'node:assert/strict';
import {currentBotActivity} from '../lib/bot-activity.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const now=Date.now(),expires_at=new Date(now+60000).toISOString();
const ticket={kind:'contacts',state:'consumed',expires_at};
assert.equal(currentBotActivity({paused:false,tickets:[ticket],screening:[]},now).label,'Finding property owners');
assert.equal(currentBotActivity({paused:true,tickets:[ticket],screening:[]},now).active,false,'paused takes precedence');
for(const state of ['issued','complete','held'])assert.equal(currentBotActivity({paused:false,tickets:[{...ticket,state}],screening:[]},now).active,false,'unstarted/finished tickets never animate');
assert.equal(currentBotActivity({paused:false,tickets:[{...ticket,expires_at:new Date(now-1).toISOString()}],screening:[]},now).active,false,'expired work never appears live');
assert.equal(currentBotActivity({paused:false,tickets:[{...ticket,kind:'toString'}],screening:[]},now).active,false,'unknown labels are ignored');
assert.equal(currentBotActivity({paused:false,tickets:[],screening:[{state:'running',lease_until:expires_at}]},now).label,'Checking property numbers');
assert.equal(currentBotActivity({paused:false,tickets:[],screening:[{state:'queued',lease_until:expires_at}]},now).label,'Waiting for the next task');
for(const [progress,label] of [[{status:'budget_reached'},'Waiting for available credits'],[{status:'paced'},'Waiting for eligible work'],[{status:'ready',callsBudgetHeld:25},'Waiting for the next task'],[{status:'settling',callsBudgetHeld:25},'Confirming earlier work costs']]){
 const input={paused:false,tickets:[],screening:[],progress};assert.equal(currentBotActivity(input,now).label,label);assert.equal(currentBotActivity(input,now).active,false);
 assert.equal(currentBotActivity({...input,paused:true},now).label,'Paused');
}
let authorized=true,failed=false,queries=[];
for(const reason of ['configuration_expired','configuration_disabled','system_paused','no_completed_work']){
 const value=currentBotActivity({paused:false,tickets:[ticket],screening:[],progress:{status:'ready',health:{status:'blocked',reason}}},now);
 assert.equal(value.blocked,true);assert.equal(value.active,false,'a claimed ticket cannot prove account recovery');
 assert.equal(value.blockedReason,reason,'Typed reason preserves the recorded blocker');
 assert(!value.label.includes('next task'));
 assert.doesNotMatch(value.label,/stalled|work is delayed|work delayed/i);
 if(reason==='no_completed_work')assert.equal(value.label,'No recent completed task was recorded.','Missing completion evidence remains explicit');
}
for(const reason of [undefined,'toString','unrecognized'])assert.equal(currentBotActivity({paused:false,tickets:[ticket],screening:[],progress:{health:{status:'blocked',reason}}},now).blockedReason,'unknown','Missing or unknown reasons cannot invent a specific blocker');
const pendingInput={paused:false,tickets:[],screening:[],progress:{status:'ready',health:{status:'blocked',reason:'pending_work'}}};
for(const activeInput of [{tickets:[ticket]},{screening:[{state:'running',lease_until:expires_at}]}]){
 const value=currentBotActivity({...pendingInput,...activeInput},now);
 assert.equal(value.active,true,'Independent current work remains visible beside pending originals');
 assert.equal(value.pendingConfirmation,true,'Current work never clears the original confirmation gap');
 assert.notEqual(value.blocked,true,'A pending original does not prove all work is blocked');
}
for(const inactiveInput of [{},{tickets:[{...ticket,state:'issued'}]},{tickets:[{...ticket,expires_at:new Date(now-1).toISOString()}]},{screening:[{state:'running',lease_until:new Date(now-1).toISOString()}]}]){
 const value=currentBotActivity({...pendingInput,...inactiveInput},now);
 assert.equal(value.active,false);assert.equal(value.pendingConfirmation,true);
 assert.equal(value.label,'Earlier work is awaiting confirmation.');
}
assert.equal(currentBotActivity({...pendingInput,paused:true,tickets:[ticket]},now).label,'Paused');
assert.deepEqual(pendingInput.progress,{status:'ready',health:{status:'blocked',reason:'pending_work'}},'Presentation never changes the health observation');
assert.equal(currentBotActivity({paused:false,tickets:[ticket],screening:[],progress:{health:{status:'unavailable'}}},now).unavailable,true);
const account='00000000-0000-4000-8000-000000000001';
const request=new Request('https://workspace.invalid/api/work/bot-status');
const route=await loadService('app/api/work/bot-status/route.ts',{
 currentBotActivity,
 NextResponse:{json:(body,options={})=>({body,...options})},
 workAccount:async({signal})=>{assert.equal(signal,request.signal);if(!authorized)throw Error('SIGN_IN_REQUIRED');return {accountId:account};},
 db:async(path,method,body,signal)=>{
  assert.equal(signal,request.signal);
  queries.push(path);if(failed)throw Error('database unavailable');
  if(path==='rpc/icash_prospecting_progress'){assert.equal(method,'POST');assert.deepEqual(body,{p_account:account});return {status:'budget_reached',callsBudgetHeld:25};}
  assert(path.includes(`eq.${account}`),'all reads are authenticated-account scoped');
  assert(!path.includes('token')&&!path.includes('snapshot')&&!path.includes('result'),'no secrets, property or contact data queried');
  return path.startsWith('icash_accounts?')?[{bot_paused:false}]:path.startsWith('icash_automation_tickets?')?[ticket]:[];
 },
});
let response=await route.GET(request);assert.equal(response.body.label,'Finding property owners');assert.equal(response.headers['Cache-Control'],'private, no-store');
assert.equal(queries.length,4);authorized=false;queries=[];assert.equal((await route.GET(request)).status,401);assert.equal(queries.length,0,'no reads without authentication');
authorized=true;failed=true;response=await route.GET(request);assert.equal(response.status,503);assert(!('active' in response.body),'failure never fabricates work');
console.log('PASS bot activity: actual active tasks, waiting/paused/stale states, tenant scoping, no contact data and authentication');
