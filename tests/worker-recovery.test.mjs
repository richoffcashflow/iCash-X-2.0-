import assert from 'node:assert/strict';
import {createScheduler} from '../worker/scheduler.mjs';
import {automationTick} from '../worker/runner.mjs';
let time=0,screenCalls=0,autoCalls=0,screenFails=true,autoFails=true;
const scheduler=createScheduler({now:()=>time,screening:async()=>{screenCalls++;if(screenFails)throw Error('DB outage');return true;},automation:async()=>{autoCalls++;if(autoFails)throw Error('Provider outage');return true;}});
assert.equal(await scheduler.run(),2000);
assert.equal(screenCalls,1);assert.equal(autoCalls,1,'screening failure must not starve automation');
assert.equal(scheduler.health().body.status,'degraded');
assert.equal(scheduler.health().code,200);
time=2000;await scheduler.run();assert.equal(autoCalls,1,'automation has independent backoff');
time=6000;await scheduler.run();assert.equal(scheduler.health().code,503);
screenFails=false;time=30000;await scheduler.run();
assert.equal(screenCalls,4);assert.equal(autoCalls,2);assert.equal(scheduler.health().code,200);
time=90000;await scheduler.run();assert.equal(autoCalls,3);assert.equal(scheduler.health().code,503,'repeated automation-only failures must fail health');
assert.equal(scheduler.health().body.automation,'held');
assert.equal(scheduler.health(false).code,200);assert.equal(scheduler.health(false).body.automation,'standby');
time=210000;autoFails=false;await scheduler.run();assert.equal(scheduler.health().code,200);assert.equal(scheduler.health().body.status,'screening');
assert.equal(scheduler.health().body.automation,'available');
// A long provider attempt starts its backoff only after completion, not before.
let slowTime=0;const slow=createScheduler({now:()=>slowTime,screening:async()=>false,automation:async()=>{slowTime+=55000;throw Error('timeout');}});
assert.equal(await slow.run(),0);assert.equal(await slow.run(),15000);
// Automation backoff grows to, and stays at, five minutes while screening continues.
let capTime=0;const autoTimes=[];
const capped=createScheduler({now:()=>capTime,screening:async()=>false,automation:async()=>{autoTimes.push(capTime);throw Error('still unavailable');}});
for(let i=0;i<150;i++)capTime+=await capped.run();
const gaps=autoTimes.slice(1).map((at,i)=>at-autoTimes[i]);
assert.deepEqual(gaps.slice(0,5),[30000,60000,120000,240000,300000]);
assert(gaps.slice(5).every(gap=>gap===300000));
// Never reuse an uncertain provider ticket. Future attempts request a new DB capability.
let tickets=0,attempts=0;const tokens=['a','b'].map(c=>`${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}`.repeat(2));
const used=[];const rpc=async()=>({token:tokens[tickets++]});
const transport=async(_url,opts)=>{attempts++;used.push(opts.headers.Authorization);throw Error('ambiguous timeout');};
await assert.rejects(automationTick(rpc,transport));assert.equal(attempts,1);
await assert.rejects(automationTick(rpc,transport));assert.equal(attempts,2);assert.notEqual(used[0],used[1]);
// Overlapping loops cannot claim concurrent work in one worker process.
let release;const pending=new Promise(resolve=>{release=resolve;});
const concurrent=createScheduler({screening:()=>pending,automation:async()=>false});const running=concurrent.run();
await assert.rejects(concurrent.run(),/WORKER_LOOP_ALREADY_RUNNING/);release(false);await running;
console.log('Worker recovery: independent lanes, backoff, health, fresh tickets and overlap guard passed');
