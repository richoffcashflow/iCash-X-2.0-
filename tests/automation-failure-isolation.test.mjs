import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {OwnerPreviewRateLimitError,OwnerExportCapacityBusyError} from '../lib/owner-enrichment-deferral.ts';
import {OwnerExportPreflightPendingError} from '../lib/owner-export-preflight.ts';
import {ProspectingBudgetError} from '../lib/voice-budget-failure.ts';
import {automationTick} from '../worker/runner.mjs';
import {createScheduler} from '../worker/scheduler.mjs';

// Compose the real route, runner and scheduler. Only the DB and provider
// services are fixtures; no network request or paid action is performed.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const header='x-icash-automation-outcome';
let rows,issued,dbCalls,actions,logs,finishMode,readbackMode,consumeFails,serviceFailure;
function reset(){rows=new Map();issued=[];dbCalls=[];actions=[];logs=[];finishMode='confirmed';readbackMode='exact';consumeFails=false;serviceFailure=null;}
function add(kind,number){const row={id:id(number),account_id:id(100+number),kind,token:id(200+number).repeat(2),state:'issued',outcome:null};rows.set(row.token,row);return row;}
const db=async(path,method='GET',body)=>{
 dbCalls.push({path,method,body});
 if(path==='rpc/icash_consume_automation'){
  if(consumeFails)throw Error('private database failure');
  const row=rows.get(body.p_token);if(!row||row.state!=='issued')return null;
  row.state='consumed';return {id:row.id,accountId:row.account_id,kind:row.kind,screeningId:id(300),voiceJobId:id(301),openerMessageId:id(302)};
 }
 if(['rpc/icash_finish_owner_enrichment','rpc/icash_finish_automation'].includes(path)){
  const row=[...rows.values()].find(row=>row.id===body.p_id);
  if(finishMode==='throw')throw Error('private unknown completion');
  if(finishMode!=='confirmed')return finishMode;
  if(!row||row.state!=='consumed'||path==='rpc/icash_finish_owner_enrichment'&&row.token!==body.p_token)return false;
  row.state=body.p_success?'complete':'held';row.outcome=body.p_outcome;
  return path==='rpc/icash_finish_owner_enrichment'?true:null;
 }
 if(path.startsWith('icash_automation_tickets?')){
  assert.equal(method,'GET');
  if(readbackMode==='throw')throw Error('private read unavailable');
  const query=new URLSearchParams(path.split('?')[1]);
  assert.equal(query.get('limit'),'1');
  const row=rows.get(query.get('token')?.slice(3));
  assert.equal(query.get('id'),'eq.'+row.id);assert.equal(query.get('account_id'),'eq.'+row.account_id);
  if(readbackMode==='missing')return [];
  return [{...row,...(readbackMode==='exact'?{}:{[readbackMode]:'mismatch'})}];
 }
 throw Error('Unexpected fixture database call');
};
const failed=kind=>async account=>{
 actions.push({kind,account});
 if(kind==='contacts'&&account===id(104))return {status:'contacts_saved'};
 throw Error(serviceFailure??(kind==='contacts'?'OWNER_EXPORT_RECONCILIATION_REQUIRED':'DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY'));
};
const completed=(kind,status)=>async account=>{actions.push({kind,account});return {status};};
const {POST}=await loadService('app/api/internal/automation/route.ts',{
 db,OwnerPreviewRateLimitError,OwnerExportCapacityBusyError,OwnerExportPreflightPendingError,ProspectingBudgetError,
 automationWorkReady:()=>true,newLiveWorkKinds:new Set(),NextResponse:{json:Response.json},
 enrichForAccount:failed('contacts'),discoverForAccount:failed('discovery'),
 dispatchLiveVoice:completed('voice_dispatch','call_started'),dispatchTextMessage:completed('seller_opener','message_accepted'),
 console:{error:(...args)=>logs.push(args)},
});
const request=row=>new Request('https://fixture.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+row.token}});
const transport=async(_url,options)=>POST(new Request('https://fixture.invalid/api/internal/automation',options));

for(const kind of ['contacts','discovery']){
 reset();const row=add(kind,1),result=await POST(request(row));
 assert.equal(result.status,503,'The failed operation remains a failed HTTP outcome');
 assert.equal(result.headers.get(header),'job-held');
 assert.deepEqual(await result.json(),{status:'held_for_reconciliation'});
 assert.equal(row.state,'held');assert.equal(actions.length,1);assert.equal(logs.length,1,'The job failure stays in operator diagnostics');
 assert.equal((await POST(request(row))).status,401,'The failed one-use capability cannot replay');
 assert.equal(actions.length,1);
}

// A failed account must not consume a shared slot's retry budget. Repeated
// failures from separate jobs still allow the next account to run immediately,
// while calls/texts in their dedicated pools continue independently.
{
 reset();let now=0;
 const queues={research:[add('contacts',1),add('discovery',2),add('contacts',3),add('contacts',4)],voice:[add('voice_dispatch',5)],messages:[add('seller_opener',6)]};
 const scheduler=createScheduler({now:()=>now,automationPools:['research','voice','messages'],screening:async()=>false,
  automation:pool=>automationTick(async()=>{const row=queues[pool].shift();if(row)issued.push(row.token);return row?{token:row.token}:null;},transport,pool)});
 for(now=0;now<=2000;now+=250){scheduler.run();await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(issued.length,6,'All fresh jobs run without waiting for 30-second or five-minute slot backoff');
 assert.equal(new Set(issued).size,issued.length);assert.equal(actions.length,6,'Each provider service executes once');
 assert.equal([...rows.values()].filter(row=>row.state==='held').length,3);
 assert.equal([...rows.values()].filter(row=>row.state==='complete').length,3);
 assert.equal(logs.length,3);assert.equal(scheduler.health().code,200);assert.equal(scheduler.health().body.automation,'available');
 await scheduler.stop();
}

// A false/stale token completion, malformed acknowledgment, unknown write or
// unconfirmed legacy readback must retain the original failure signal.
for(const kind of ['contacts','discovery'])for(const mode of ['throw',false,null,undefined,'true']){
 reset();const row=add(kind,1);finishMode=mode;
 const result=await POST(request(row));assert.equal(result.status,503);assert.equal(result.headers.get(header),null);
 assert.equal(actions.length,1);assert.equal(row.state,'consumed');
}
for(const mode of ['throw','missing','id','account_id','kind','token','state','outcome']){
 reset();const row=add('discovery',1);readbackMode=mode;
 const result=await POST(request(row));assert.equal(result.status,503);assert.equal(result.headers.get(header),null);
 assert.equal(actions.length,1);assert.equal(row.state,'held','Failed acknowledgment never releases the original hold');
}
reset();const unclaimed=add('contacts',1);consumeFails=true;
assert.equal((await POST(request(unclaimed))).headers.get(header),null);assert.equal(actions.length,0);
for(const kind of ['contacts','discovery'])for(const reason of ['Database request failed','DISCOVERY_CONFIGURATION_INVALID','DISCOVERY_FILTER_INVALID','DISCOVERY_RATE_TOO_LOW','private unexpected exception']){
 reset();const row=add(kind,1);serviceFailure=reason;
 const result=await POST(request(row));assert.equal(result.status,503);assert.equal(result.headers.get(header),null);
 assert.equal(row.state,'held','Persisting the original hold does not hide a shared infrastructure failure');
 assert.equal(dbCalls.length,2,'Shared infrastructure failures do not require the job acknowledgment readback');
}

// The runner does not trust a body string, a marker on another status, a
// malformed marker or an ordinary unacknowledged 503.
for(const [status,value] of [[503,null],[503,'JOB-HELD'],[503,'job-held,other'],[401,'job-held'],[500,'job-held']]){
 let claims=0,dispatches=0;
 await assert.rejects(automationTick(async()=>{claims++;return {token:id(1).repeat(2)};},async()=>{dispatches++;return Response.json({status:'held_for_reconciliation'},{status,headers:value?{[header]:value}:{}});},'research'),error=>error.code==='AUTOMATION_HELD');
 assert.equal(claims,1);assert.equal(dispatches,1);
}
// An uncertain write still causes normal bounded infrastructure backoff.
{
 reset();let now=0,claims=0;finishMode='throw';const queue=[add('contacts',1),add('contacts',2)];
 const scheduler=createScheduler({now:()=>now,automationPools:['research'],screening:async()=>false,
  automation:()=>automationTick(async()=>{claims++;return {token:queue.shift().token};},transport,'research')});
 scheduler.run();await new Promise(resolve=>setImmediate(resolve));
 now=29999;scheduler.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(claims,1);
 now=30000;scheduler.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(claims,2);
 assert.equal(scheduler.health().body.status,'degraded');await scheduler.stop();
}
console.log('Automation failure isolation: durable job holds preserve receipts and one-use capability, fresh independent jobs continue, unknown persistence retains backoff. Offline only.');
