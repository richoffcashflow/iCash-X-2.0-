import assert from 'node:assert/strict';
import {createScheduler} from '../worker/scheduler.mjs';
import {createHeartbeat} from '../worker/heartbeat.mjs';
import {WorkerOperationError} from '../worker/runner.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const databaseFailure=operation=>new WorkerOperationError('SCREENING_DATABASE_UNAVAILABLE',operation,500,'57014');

// Production returned a successful or empty scheduler poll between recurring
// SQL timeouts. Neither outcome may erase the recent infrastructure failures.
for(const operation of ['icash_next_automation','icash_next_automation_lane']){
 let time=0,attempts=0;
 const results=[databaseFailure(operation),false,databaseFailure(operation),true,databaseFailure(operation),false];
 const scheduler=createScheduler({now:()=>time,automationPools:['general'],screening:async()=>false,
  automation:async()=>{attempts++;const result=results.shift()??false;if(result instanceof Error)throw result;return result;},
  onFailure:()=>{throw Error('reporting unavailable');}});
 const step=async at=>{time=at;scheduler.run();await flush();};
 for(const at of [0,30000,60000,90000])await step(at);
 assert.equal(scheduler.health().body.status,'screening','Two historical failures alone do not keep health degraded after recovery');
 assert.deepEqual(scheduler.health().body.recurringSchedulerFailurePools,[]);
 await step(120000);await step(150000);
 assert.equal(attempts,6,'Health detection does not add retries or replay work');
 const health=scheduler.health();
 assert.equal(health.body.status,'degraded','Three intermittent database failures remain visible after a successful/idle poll');
 assert.deepEqual(health.body.recurringSchedulerFailurePools,['general']);
 assert.equal(health.code,200,'Existing consecutive-failure and stalled HTTP rules remain independent');
 assert.equal(health.body.automation,'available','A recurring fault does not stop independent work');
 assert.equal(scheduler.health(false).body.status,'standby');
 assert.equal(scheduler.health(false).code,200);
 const heartbeats=[];
 const beat=createHeartbeat({now:()=>time,health:()=>scheduler.health(),rpc:async(name,args)=>heartbeats.push({name,args})});
 await beat();
 assert.equal(heartbeats.at(-1).args.p_status,'degraded','The existing durable heartbeat receives the recurring fault');
 // Refresh the polling loop while testing the exact window boundary so a
 // separate stalled-loop condition cannot accidentally satisfy this assertion.
 await step(15*60000-1);
 assert.equal(scheduler.health().body.status,'degraded');
 await step(15*60000);
 assert.equal(scheduler.health().body.status,'screening','Old failures expire instead of keeping the worker red indefinitely');
 assert.deepEqual(scheduler.health().body.recurringSchedulerFailurePools,[]);
 await beat();assert.equal(heartbeats.at(-1).args.p_status,'ok');
 await scheduler.stop();
}

// Each production pool has two slots. Errors split between its slots must
// combine, while a healthy voice pool keeps making progress throughout.
{
 let time=0,general=0,voice=0;
 const scheduler=createScheduler({now:()=>time,automationPools:['general','general','voice'],screening:async()=>false,
  automation:async pool=>{if(pool==='voice'){voice++;return true;}general++;if([1,2,5].includes(general))throw databaseFailure('icash_next_automation_lane');return false;}});
 for(const at of [0,250,500,30000,30250,30500,60000,60250,60500,90000]){
  time=at;scheduler.run();await flush();
 }
 const health=scheduler.health();
 assert.equal(voice,3,'Healthy pool continues during the database fault');
 assert.deepEqual(health.body.recurringSchedulerFailurePools,['general']);
 assert.equal(health.body.status,'degraded');assert.equal(health.code,200);
 assert.equal(health.body.automation,'available');
 assert(health.body.pools.every(pool=>!pool.failed),'Recurring detection is separate from consecutive slot failures');
 await scheduler.stop();
}

// Retaining bounded history must keep the newest failures, not clear a still
// recurring fault as soon as its first-ever failure leaves the window.
{
 let time=0,calls=0;
 const scheduler=createScheduler({now:()=>time,automationPools:['general'],screening:async()=>false,
  automation:async()=>{if(++calls<=8&&calls%2)throw databaseFailure('icash_next_automation_lane');return false;}});
 for(const at of [0,30000,60000,90000,120000,150000,180000,210000,900000]){
  time=at;scheduler.run();await flush();
 }
 assert.equal(scheduler.health().body.status,'degraded','The newest three failures remain within the window');
 time=960000;scheduler.run();await flush();
 assert.equal(scheduler.health().body.status,'screening');
 await scheduler.stop();
}

// Separate lightly affected pools do not combine into an invented recurring
// outage for one pool; every pool needs its own three observed failures.
{
 let time=0;const calls={general:0,research:0};
 const scheduler=createScheduler({now:()=>time,automationPools:['general','research'],screening:async()=>false,
  automation:async pool=>{const call=++calls[pool];if(call===1||call===3)throw databaseFailure('icash_next_automation_lane');return false;}});
 for(const at of [0,250,30000,30250,60000,60250,90000,90250]){
  time=at;scheduler.run();await flush();
 }
 assert.deepEqual(calls,{general:4,research:4});
 assert.deepEqual(scheduler.health().body.recurringSchedulerFailurePools,[]);
 assert.equal(scheduler.health().body.status,'screening');
 await scheduler.stop();
}

// Unrelated account/provider holds must not masquerade as recurring database
// scheduling faults after those attempts recover.
for(const error of [
 new WorkerOperationError('AUTOMATION_HELD','automation_dispatch',503),
 new WorkerOperationError('SCREENING_DATABASE_UNAVAILABLE','icash_claim_screening',500,'57014'),
 new Error('private provider details'),
]){
 let time=0,calls=0;
 const scheduler=createScheduler({now:()=>time,automationPools:['general'],screening:async()=>false,
  automation:async()=>{if(++calls%2)throw error;return false;}});
 for(const at of [0,30000,60000,90000,120000,150000]){time=at;scheduler.run();await flush();}
 assert.deepEqual(scheduler.health().body.recurringSchedulerFailurePools,[]);
 assert.equal(scheduler.health().body.status,'screening');
 await scheduler.stop();
}
console.log('PASS recurring scheduler database failures: intermittent recovery, pool aggregation, heartbeat propagation, bounded expiry and independent work. Offline only.');
