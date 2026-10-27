import assert from 'node:assert/strict';
import {createScheduler} from '../worker/scheduler.mjs';
import {automationPools} from '../worker/pools.mjs';
import {automationTick} from '../worker/runner.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const count of [8,16]){
 let time=0,screened=0;const started=[],release=[];
 const pools=automationPools({ICASH_AUTOMATION_CONCURRENCY:String(count)});
 const scheduler=createScheduler({now:()=>time,automationPools:pools,screening:async()=>{screened++;return true;},automation:pool=>{started.push(pool);return new Promise(resolve=>release.push(resolve));}});
 for(time=0;time<count*250;time+=250){scheduler.run();scheduler.run();await flush();}
 assert.equal(started.length,count);assert.deepEqual(started,pools);
 assert.equal(scheduler.health().body.automationConcurrency,count);assert.equal(scheduler.health().body.automationInFlight,count);
 assert(screened>=count,'pure screening continues through all provider waits');
 time+=20000;scheduler.run();await flush();assert.equal(started.length,count,'slow attempts cannot be replayed');
 const recovery=pools.indexOf('recovery');release[recovery](true);await flush();time+=250;scheduler.run();await flush();
 assert.equal(started.length,count+1);assert.equal(started.at(-1),'recovery','recovery has capacity even while every outreach slot is waiting');
 const draining=scheduler.stop();time+=1000;scheduler.run();await flush();assert.equal(started.length,count+1);
 release.forEach(resolve=>resolve(false));await draining;
 assert.equal(scheduler.health().body.automationInFlight,0);
}
// Immediate completion must rotate through all families, not monopolize slot 0.
let time=0;const seen=[];const scheduler=createScheduler({now:()=>time,automationPools:automationPools({}),screening:async()=>false,automation:async pool=>{seen.push(pool);return true;}});
for(time=0;time<4000;time+=250){scheduler.run();await flush();}
assert.deepEqual(seen.slice(0,8),automationPools({}));assert.deepEqual(seen.slice(8),automationPools({}));
await scheduler.stop();
for(const bad of ['0','4','12','17','NaN'])assert.throws(()=>automationPools({ICASH_AUTOMATION_CONCURRENCY:bad}));
for(const bad of [[],Array(17).fill('general'),['untrusted']])assert.throws(()=>createScheduler({screening:async()=>false,automation:async()=>false,automationPools:bad}));
const token='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'.repeat(2),calls=[];
await automationTick(async(name,args)=>{calls.push({name,args});return {token};},async(url,opts)=>{assert.equal(url,'https://www.geticashx.com/api/internal/automation');assert.equal(opts.headers.Authorization,'Bearer '+token);return new Response('{}');},'research');
assert.deepEqual(calls,[{name:'icash_next_automation_lane',args:{p_lane:'research'}}]);
await assert.rejects(automationTick(async()=>assert.fail('invalid lane reached DB'),fetch,'unknown'));
console.log('Parallel worker: 8/16 bounded slots, reserved recovery, round-robin claims, no replay, isolated screening, shutdown and lane validation passed. Offline only.');
