import assert from 'node:assert/strict';
import {installReminderTracking} from '../lib/webinar-reminder-client.ts';
const uuid='00000000-0000-4000-8000-000000000001',saved={};
for(const key of ['document','window','location','navigator','localStorage','setTimeout','clearTimeout'])saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);
let tasks=new Map(),next=0,denied=false,publicCheckout=false;
const doc=new EventTarget(),win=new EventTarget();doc.hidden=false;doc.cookie=`icash_webinar_reminder_visit=${uuid}`;doc.querySelector=()=>publicCheckout?{}:null;
const location={pathname:'/webinar',search:''},nav={globalPrivacyControl:false};
Object.defineProperties(globalThis,{document:{value:doc,configurable:true},window:{value:win,configurable:true},location:{value:location,configurable:true},navigator:{value:nav,configurable:true},localStorage:{value:{getItem:()=>denied?'deny':null},configurable:true},setTimeout:{value:fn=>{tasks.set(++next,fn);return next;},configurable:true},clearTimeout:{value:n=>tasks.delete(n),configurable:true}});
const flush=async()=>{const pending=[...tasks.values()];tasks.clear();for(const fn of pending)await fn();await Promise.resolve();await Promise.resolve();};
const play=()=>win.dispatchEvent(new CustomEvent('icash-webinar-track',{detail:{kind:'started',sessionId:uuid}}));
try{
 let calls=[],stop=installReminderTracking(async body=>{calls.push(body);return true;});
 assert.equal(calls.length,0);play();assert.equal(calls.length,0,'Early playback waits for visible-page confirmation');await flush();
 assert.deepEqual(calls,[{action:'visit'},{action:'watch',sessionId:uuid}]);play();await flush();assert.equal(calls.length,2,'Repeat playback events do not double count');stop();
 calls=[];doc.hidden=true;stop=installReminderTracking(async body=>{calls.push(body);return true;});await flush();assert.equal(calls.length,0);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls.length,0,'A transient background preview is not confirmed');
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls.length,1);stop();
 for(const state of ['preview','private','gpc','denied','no-cookie']){
  calls=[];location.search=state==='preview'?'?preview=fixture':'';location.pathname=state==='private'?'/admin':'/webinar';nav.globalPrivacyControl=state==='gpc';denied=state==='denied';doc.cookie=state==='no-cookie'?'':`icash_webinar_reminder_visit=${uuid}`;
  stop=installReminderTracking(async body=>{calls.push(body);return true;});await flush();play();assert.equal(calls.length,0,state);stop();
 }
 location.pathname='/';location.search='';nav.globalPrivacyControl=false;denied=false;doc.cookie=`icash_webinar_reminder_visit=${uuid}`;calls=[];
 stop=installReminderTracking(async body=>{calls.push(body);return true;});await flush();assert.equal(calls.length,0,'Signed-in workspace is not a public checkout');publicCheckout=true;win.dispatchEvent(new Event('icash-public-checkout-change'));await flush();assert.equal(calls.length,1);stop();
 location.pathname='/webinar';calls=[];stop=installReminderTracking(async body=>{calls.push(body);throw Error('network');});await flush();await flush();await flush();await flush();assert.equal(calls.length,3,'Only bounded telemetry retries');stop();
 calls=[];stop=installReminderTracking(async body=>{calls.push(body);return true;});stop();await flush();assert.equal(calls.length,0,'Unmount cancels pending confirmation');
 console.log('PASS reminder browser tracking: visible landing, real playback event, repeat deduplication, hidden/preview/private exclusions, GPC/opt-out, bounded errors and navigation cleanup.');
}finally{for(const [key,descriptor] of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
