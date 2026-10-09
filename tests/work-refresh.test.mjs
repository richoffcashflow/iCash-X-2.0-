import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {notifyWorkUpdated,startWorkPolling} from '../lib/work-refresh.ts';

const oldDocument=globalThis.document,oldWindow=globalThis.window;
globalThis.document=Object.assign(new EventTarget(),{hidden:false});
globalThis.window=new EventTarget();
mock.timers.enable({apis:['setInterval']});
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
let calls=0,received=[],errors=[],finish,signal;
const stop=startWorkPolling({
 load:s=>{calls++;signal=s;return new Promise((resolve,reject)=>{finish={resolve,reject};});},
 onData:data=>received.push(data),onError:error=>errors.push(error.message)
});
try{
 assert.equal(calls,1,'An opened view loads immediately');
 notifyWorkUpdated();window.dispatchEvent(new Event('focus'));mock.timers.tick(30000);
 assert.equal(calls,1,'Concurrent refresh triggers cannot overlap requests');
 finish.resolve('seller signed');await settle();
 assert.deepEqual(received,['seller signed']);assert.equal(calls,2,'A mutation during a request gets one fresh follow-up read');
 finish.resolve('buyer signed');await settle();
 document.hidden=true;mock.timers.tick(60000);window.dispatchEvent(new Event('online'));
 assert.equal(calls,2,'Hidden views do not poll');
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,3);
 finish.reject(Error('Temporary connection failure'));await settle();assert.deepEqual(errors,['Temporary connection failure']);assert.deepEqual(received,['seller signed','buyer signed'],'A failed refresh does not erase saved data');
 window.dispatchEvent(new Event('online'));assert.equal(calls,4);finish.resolve('deposit confirmed');await settle();
 notifyWorkUpdated();assert.equal(calls,5);const outstanding=finish;
 stop();assert.equal(signal.aborted,true);outstanding.resolve('old view response');await settle();
 assert.deepEqual(received,['seller signed','buyer signed','deposit confirmed'],'Unmounted views cannot receive stale results');
 mock.timers.tick(60000);notifyWorkUpdated();window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(calls,5,'Cleanup removes timers and every refresh listener');
 console.log('Work refresh scenarios passed: immediate load, mutation updates, focus, reconnect, hidden tab, no overlap, failure recovery and stale-response cleanup.');
}finally{stop();mock.timers.reset();if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
