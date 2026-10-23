import assert from 'node:assert/strict';
import {createScheduler} from '../worker/scheduler.mjs';
import {automationTick} from '../worker/runner.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const step=async scheduler=>{scheduler.run();await flush();return scheduler.run();};
let time=0,screenCalls=0,autoCalls=0,screenFails=true,autoFails=true;
const scheduler=createScheduler({automationConcurrency:1,now:()=>time,screening:async()=>{screenCalls++;if(screenFails)throw Error('DB outage');return true;},automation:async()=>{autoCalls++;if(autoFails)throw Error('Provider outage');return true;}});
assert.equal(await step(scheduler),2000);
assert.equal(screenCalls,1);assert.equal(autoCalls,1,'screening failure must not starve automation');
assert.equal(scheduler.health().body.status,'degraded');assert.equal(scheduler.health().code,200);
time=2000;await step(scheduler);assert.equal(autoCalls,1,'automation has independent backoff');
time=6000;await step(scheduler);assert.equal(scheduler.health().code,503);
screenFails=false;time=30000;await step(scheduler);assert.equal(screenCalls,4);assert.equal(autoCalls,2);assert.equal(scheduler.health().code,200);
time=90000;await step(scheduler);assert.equal(autoCalls,3);assert.equal(scheduler.health().code,503);
assert.equal(scheduler.health().body.automation,'held');assert.equal(scheduler.health(false).code,200);
time=210000;autoFails=false;await step(scheduler);assert.equal(scheduler.health().code,200);assert.equal(scheduler.health().body.automation,'available');
// Four concurrent provider waits, independent screening, staggered claims, no
// repeated work from overlapping loop invocations, and a hard concurrency bound.
let parallelTime=0,screened=0,claimed=0;const releases=[];
const parallel=createScheduler({now:()=>parallelTime,screening:async()=>{screened++;return true;},automation:()=>{claimed++;return new Promise(resolve=>releases.push(resolve));}});
for(parallelTime=0;parallelTime<=3000;parallelTime+=250){parallel.run();parallel.run();await flush();}
assert.equal(claimed,4);assert.equal(screened,13);assert.equal(parallel.health().body.automationConcurrency,4);assert.equal(parallel.health().body.automationInFlight,4);
parallelTime=5000;await step(parallel);assert.equal(claimed,4,'slow calls are never duplicated');
releases[0](true);await flush();parallelTime=5999;await step(parallel);assert.equal(claimed,4);
parallelTime=6000;await step(parallel);assert.equal(claimed,5,'one completed lane can refill while three others wait');
let stopped=false;const draining=parallel.stop().then(()=>{stopped=true;});await flush();assert.equal(stopped,false);
parallelTime=10000;parallel.run();await flush();assert.equal(claimed,5,'shutdown cannot claim fresh work');
releases.forEach(release=>release(true));await draining;assert.equal(stopped,true);
assert.equal(parallel.health().body.automationInFlight,0);
for(const invalid of [0,5,NaN,1.5,'4'])assert.throws(()=>createScheduler({screening:async()=>false,automation:async()=>false,automationConcurrency:invalid}),/INVALID_WORKER_CONCURRENCY/);
// A slow failure starts backoff at completion and does not block screening.
let slowTime=0,rejectSlow,slowAttempts=0,slowScreens=0;
const slow=createScheduler({automationConcurrency:1,now:()=>slowTime,screening:async()=>{slowScreens++;return true;},automation:()=>{slowAttempts++;return new Promise((_resolve,reject)=>{rejectSlow=reject;});}});
await step(slow);slowTime=50000;await step(slow);assert.equal(slowAttempts,1);assert.equal(slowScreens,2);
slowTime=55000;rejectSlow(Error('timeout'));await flush();slowTime=84999;await step(slow);assert.equal(slowAttempts,1);
slowTime=85000;await step(slow);assert.equal(slowAttempts,2);rejectSlow(Error('timeout'));await flush();
// Backoff remains bounded at five minutes, even with a broken reporting hook.
let capTime=0;const autoTimes=[];
const capped=createScheduler({automationConcurrency:1,now:()=>capTime,screening:async()=>false,automation:async()=>{autoTimes.push(capTime);throw Error('unavailable');},onFailure:()=>{throw Error('log failed');}});
while(capTime<1500000)capTime+=await step(capped);
const gaps=autoTimes.slice(1).map((at,i)=>at-autoTimes[i]);
assert.deepEqual(gaps.slice(0,5),[30000,60000,120000,240000,300000]);assert(gaps.slice(5).every(gap=>gap===300000));
// A stuck promise remains visible even when the polling loop is alive.
let hungTime=0,resolveHung;const hung=createScheduler({now:()=>hungTime,screening:async()=>false,automation:()=>new Promise(resolve=>{resolveHung=resolve;})});
await step(hung);hungTime=76000;assert.equal(hung.health().code,503);resolveHung(false);await flush();
// Each lane backs off separately. One failure cannot suppress three usable lanes.
let mixedTime=0,mixedCalls=0;const mixed=createScheduler({now:()=>mixedTime,screening:async()=>false,automation:async()=>{mixedCalls++;if(mixedCalls===1)throw Error('one account held');return false;}});
for(mixedTime=0;mixedTime<=3000;mixedTime+=1000)await step(mixed);
assert.equal(mixedCalls,4);assert.equal(mixed.health().code,200);assert.equal(mixed.health().body.automation,'available');
// Never reuse an uncertain provider ticket. Future attempts ask the DB anew.
let tickets=0;const tokens=['a','b'].map(c=>`${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}`.repeat(2));
const used=[];const rpc=async()=>({token:tokens[tickets++]});
const transport=async(_url,opts)=>{used.push(opts.headers.Authorization);throw Error('ambiguous timeout');};
await assert.rejects(automationTick(rpc,transport));await assert.rejects(automationTick(rpc,transport));
assert.equal(used.length,2);assert.notEqual(used[0],used[1]);
// Idle polling stays within 15 seconds and pure screening within one minute.
let idleTime=0;const idleCalls=[];const idle=createScheduler({automationConcurrency:1,now:()=>idleTime,screening:async()=>{idleCalls.push(idleTime);return false;},automation:async()=>false});
assert.equal(await step(idle),5000);idleTime=15000;assert.equal(await step(idle),10000);
idleTime=45000;assert.equal(await step(idle),15000);idleTime=105000;assert.equal(await step(idle),15000);
assert.deepEqual(idleCalls,[0,15000,45000,105000]);
console.log('Worker: four bounded concurrent attempts, independent screening, staggering, draining, health, backoff and no provider replay passed.');
