import assert from 'node:assert/strict';
import {createRpc,automationTick,workerFailureDetails} from '../worker/runner.mjs';
import {createScheduler} from '../worker/scheduler.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const privateDetail='private-url-token-customer';
const failures=[
 ['timeout',async()=>{throw new DOMException(privateDetail,'TimeoutError');},null,'REQUEST_TIMEOUT'],
 ['network',async()=>{throw new TypeError(privateDetail);},null,'REQUEST_FAILED'],
 ['body_timeout',async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException(privateDetail,'AbortError'));}})),200,'REQUEST_TIMEOUT'],
 ['invalid_json',async()=>new Response(privateDetail),200,'REQUEST_FAILED'],
];
for(const [label,fail,status,requestCode] of failures){
 let at=0,claims=0,sends=0;const diagnostics=[];
 const rpc=createRpc('https://fixture.supabase.co','fixture-secret',async()=>{
  claims++;return claims%2?fail():Response.json(null);
 });
 const scheduler=createScheduler({now:()=>at,automationPools:['research'],screening:async()=>false,
  automation:()=>automationTick(rpc,async()=>{sends++;assert.fail('A failed claim never dispatches');},'research'),
  onFailure:(_pool,error)=>diagnostics.push(workerFailureDetails(error))});
 for(at of [0,30000,60000,90000,120000,150000]){scheduler.run();await flush();}
 assert.equal(claims,6,label+': one attempt per scheduled poll, no immediate replay');
 assert.equal(sends,0);
 assert.deepEqual(diagnostics,Array.from({length:3},()=>({code:'SCREENING_DATABASE_UNAVAILABLE',operation:'icash_next_automation_lane',httpStatus:status,requestCode})),label);
 assert(!JSON.stringify(diagnostics).includes(privateDetail));
 assert.deepEqual(scheduler.health().body.recurringSchedulerFailurePools,['research'],label+': idle polls cannot erase repeated failed claims');
 assert.equal(scheduler.health().body.automation,'available','Independent fresh work remains available');
 await scheduler.stop();
}

// An unknown HTTP dispatch is identified separately from a failed DB claim.
// The one-use ticket is submitted once and is never retried by this worker.
const token='00000000-0000-4000-8000-000000000001'.repeat(2);
let sends=0;
await assert.rejects(automationTick(async()=>({token}),async()=>{sends++;throw new DOMException(privateDetail,'TimeoutError');},'voice'),error=>{
 assert.deepEqual(workerFailureDetails(error),{code:'AUTOMATION_HELD',operation:'automation_dispatch',httpStatus:null,requestCode:'REQUEST_TIMEOUT'});
 return true;
});
assert.equal(sends,1);
console.log('PASS worker transport failures retain their stage, bounded recurrence and no-replay boundaries.');
