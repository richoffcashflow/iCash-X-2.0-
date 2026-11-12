import assert from 'node:assert/strict';
import {createScheduler} from '../worker/scheduler.mjs';
import {createWatchdog} from '../worker/watchdog.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const [pool,deadline] of [['research',260000],['general',260000],['voice',140000],['messages',140000],['recovery',140000]]){
 let now=0,claims=0,finish,forced,delay,stops=0,logs=0,clears=0;const exits=[];
 const scheduler=createScheduler({now:()=>now,screening:async()=>false,automationPools:[pool],automation:()=>{claims++;return new Promise(resolve=>{finish=resolve;});}});
 const check=createWatchdog({isStalled:()=>scheduler.isStalled(),stop:()=>{stops++;return scheduler.stop();},exit:code=>exits.push(code),setTimer:(fn,ms)=>{forced=fn;delay=ms;return 1;},clearTimer:()=>clears++,onStall:()=>logs++});
 scheduler.run();await flush();now=deadline;scheduler.run();check();assert.equal(stops,0,'legitimate requests retain their full deadline');
 now++;scheduler.run();check(false);assert.equal(stops,0,'standby cannot restart');check();check();assert.equal(stops,1);assert.equal(logs,1);assert.equal(delay,270000);
 now+=300000;scheduler.run();await flush();assert.equal(claims,1,'draining cannot claim or replay work');assert.deepEqual(exits,[],'a stuck promise cannot skip the drain deadline');
 forced();assert.deepEqual(exits,[1]);finish(false);await flush();forced();assert.deepEqual(exits,[1]);assert.equal(clears,1);
}
// Ordinary failures/holds use scheduler backoff, not whole-process restarts.
let now=0,starts=0;const failing=createScheduler({now:()=>now,screening:async()=>false,automationPools:['voice'],automation:async()=>{starts++;throw Error('provider unavailable');}});
const noRestart=createWatchdog({isStalled:()=>failing.isStalled(),stop:()=>assert.fail('normal failure restarted'),exit:()=>assert.fail('normal failure exited')});
for(let i=0;i<5;i++){failing.run();await flush();noRestart();now+=120000;}assert(starts>=3);assert.equal(failing.health().code,503);await failing.stop();
// A lost loop with no pending work exits promptly, without waiting 270 seconds.
let stopped=0,cleared=0;const exited=[];let callback;
const loop=createWatchdog({isStalled:()=>true,stop:async()=>{stopped++;},exit:code=>exited.push(code),setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>cleared++,onStall:()=>{throw Error('log failed');}});
loop();await flush();callback();assert.equal(stopped,1);assert.equal(cleared,1);assert.deepEqual(exited,[1]);
// Screening has its own existing 75-second stuck threshold.
let clock=0,release;const screening=createScheduler({now:()=>clock,screening:()=>new Promise(r=>{release=r;}),automation:async()=>false});
screening.run();await flush();clock=75000;screening.run();assert.equal(screening.isStalled(),false);clock++;assert.equal(screening.isStalled(),true);release(false);await screening.stop();
console.log('PASS worker watchdog: real scheduler stalls, lane deadlines, standby, backoff isolation, no replay, bounded drain and once-only exit.');
