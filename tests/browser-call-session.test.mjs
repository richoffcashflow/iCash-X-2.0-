import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {BrowserCallSession} from '../lib/browser-call-session.ts';
class FakeCall extends EventEmitter {parameters={CallSid:'CAfixture'};accepted=0;rejected=0;disconnected=0;muteValue=false;accept(){this.accepted++;this.emit('accept');}reject(){this.rejected++;}disconnect(){this.disconnected++;}mute(v){this.muteValue=v;}}
class FakeDevice extends EventEmitter {audio={incoming:()=>{}};destroyed=0;async register(){}destroy(){this.destroyed++;}}
const setup=(patch={})=>{const device=new FakeDevice(),call=new FakeCall(),requests=[],states=[];const deps={microphone:async()=>{},createDevice:async()=>device,request:async(action,id)=>{requests.push(action);if(action==='prepare')return {token:'fixture'};if(action==='start'){device.emit('incoming',call);return {id,parentSid:call.parameters.CallSid};}return {ended:true};},status:async()=>({connected:true}),onState:(...v)=>states.push(v),onStarted:()=>{},...patch};return {session:new BrowserCallSession('attempt',deps),device,call,requests,states};};
let x=setup();await x.session.start();assert.equal(x.call.accepted,1,'Early incoming call waits for the matching server receipt');x.session.mute(true);assert(x.call.muteValue);await x.session.stop();assert.equal(x.call.disconnected,1);assert.equal(x.device.destroyed,1);assert.deepEqual(x.requests,['prepare','start','end']);await x.session.stop();assert.equal(x.requests.filter(v=>v==='end').length,1,'End is idempotent');
x=setup({microphone:async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});}});await x.session.start();assert.deepEqual(x.requests,[],'Mic denial never creates carrier work');assert.match(x.states.at(-1)[1],/Allow microphone/);
let resolvePrepare;x=setup({request:async(action)=>{assert.equal(action,'prepare');return new Promise(r=>resolvePrepare=r);}});const pending=x.session.start();await new Promise(r=>setImmediate(r));await x.session.stop();resolvePrepare({token:'late'});await pending;assert.equal(x.device.destroyed,0,'A stopped preparation never constructs an audio device');
let releaseStart;const device=new FakeDevice(),actions=[];x=setup({createDevice:async()=>device,request:async(action)=>{actions.push(action);return action==='prepare'?{token:'fixture'}:action==='start'?new Promise(r=>releaseStart=r):{};}});const late=x.session.start();await new Promise(r=>setImmediate(r));await x.session.stop();releaseStart({id:'attempt',parentSid:'CAfixture'});await late;assert.deepEqual(actions,['prepare','start','end','end'],'Late server dispatch is explicitly stopped again');
x=setup();x.call.parameters.CallSid='unexpected';// Return a different canonical parent; never accept an unrelated incoming call.
const mismatched=new BrowserCallSession('attempt',{microphone:async()=>{},createDevice:async()=>x.device,request:async action=>{if(action==='prepare')return {token:'fixture'};if(action==='start'){x.device.emit('incoming',x.call);return {id:'attempt',parentSid:'expected'};}return {};},status:async()=>({}),onState(){},onStarted(){}});await mismatched.start();assert.equal(x.call.accepted,0);assert.equal(x.call.rejected,1);await mismatched.stop();
console.log('PASS browser call lifecycle: receipt-bound accept, mic denial, mute/end, idempotent cleanup, close during preparation and late dispatch.');

// All provider work is mocked. A terminal receipt is distinct from an audio disconnect.
const flush=()=>new Promise(r=>setImmediate(r));
for(const [status,connected,phase,message] of [
 ['failed',false,'error',/before connecting/],
 ['failed',true,'error',/after connecting/],
 ['completed',true,'ended',null],
]){
 const sample=setup({status:async()=>({status,connected,ended:true})});
 await sample.session.start();await flush();
 assert.equal(sample.states.at(-1)[0],phase);
 if(message)assert.match(sample.states.at(-1)[1],message);
 assert.equal(sample.call.disconnected,1);assert.equal(sample.device.destroyed,1);
 assert.deepEqual(sample.requests,['prepare','start','end'],'Terminal status cleans up without redial');
 if(status==='failed')assert(!sample.states.some(([phase])=>phase==='ended'),'Failure must never be shown as normal completion');
}
for(const event of ['disconnect','cancel','reject']){
 for(const outcome of ['failed','completed','unknown','read-error']){
  let reads=0,finishRead;
  const sample=setup({status:async()=>{reads++;if(reads===1)return {connected:false};return new Promise((resolve,reject)=>{finishRead=()=>outcome==='read-error'?reject(Error('offline')):resolve(outcome==='unknown'?{status:'in-progress'}:{status:outcome,ended:true});});}});
  await sample.session.start();await flush();sample.call.emit(event);
  assert.equal(sample.call.disconnected,1,'Disconnect cleanup must not wait for final status');
  assert.equal(sample.device.destroyed,1);
  assert.equal(sample.requests.at(-1),'end','Carrier cleanup starts before final status');
  await flush();assert.equal(reads,2,'Disconnect reads final status once');finishRead();await sample.session.stop();
  assert.equal(sample.states.at(-1)[0],outcome==='completed'?'ended':'error');
  if(outcome==='failed')assert.match(sample.states.at(-1)[1],/before connecting/);
  if(outcome==='unknown'||outcome==='read-error')assert.match(sample.states.at(-1)[1],/could not be confirmed/);
  sample.call.emit(event);await flush();assert.equal(reads,2);assert.equal(sample.requests.filter(a=>a==='start').length,1);assert.equal(sample.requests.filter(a=>a==='end').length,1);
 }
}
// Remember verified connection even when the terminal response omits connected.
{
 let tick,currentStatus={connected:true};const realInterval=globalThis.setInterval;
 globalThis.setInterval=(fn,...args)=>{tick=fn;return realInterval(fn,...args);};
 const sample=setup({status:async()=>currentStatus});
 try{await sample.session.start();await flush();currentStatus={status:'failed',ended:true};tick();await flush();assert.match(sample.states.at(-1)[1],/after connecting/);}
 finally{globalThis.setInterval=realInterval;await sample.session.stop();}
}
// Even if the cleanup request fails, read the receipt once, never retry or redial.
{
 let reads=0;const actions=[];
 const sample=setup({request:async(action,id)=>{actions.push(action);if(action==='prepare')return {token:'fixture'};if(action==='start')return {id};throw Error('end unavailable');},status:async()=>{reads++;return reads===1?{}:{status:'failed',ended:true};}});
 await sample.session.start();await flush();await sample.session.stop();
 assert.deepEqual(actions,['prepare','start','end']);assert.equal(reads,2);assert.match(sample.states.at(-1)[1],/before connecting/);
}
const {guardBrowserCallCallbacks}=await import('../lib/browser-call-session.ts');
{
 let current='old',mounted=true;const updates=[];
 const callbacks=guardBrowserCallCallbacks(()=>mounted&&current==='old',{onState:(...args)=>{updates.push(args);if(args[0]==='ended'||args[0]==='error')updates.push('finished');},onStarted:()=>updates.push('started')});
 callbacks.onState('connecting');assert.equal(updates.length,1);
 let resolveStatus;const sample=setup({status:async()=>new Promise(resolve=>{resolveStatus=resolve;}),...callbacks});
 await sample.session.start();current='new';const count=updates.length;
 resolveStatus({status:'failed',ended:true});await flush();await sample.session.stop();
 callbacks.onState('error','late');callbacks.onStarted();assert.equal(updates.length,count,'Old session cannot overwrite new call or refresh its parent');
 current='old';mounted=false;callbacks.onState('ended');assert.equal(updates.length,count,'Unmounted callbacks are suppressed');
}
console.log('PASS truthful browser failures, completed receipts, disconnect/cancel/reject final reads, unknown outcomes, cleanup without redial, and stale UI guards.');

// Audio/UI stop immediately, even while end and final-status requests are pending.
{
 let resolveEnd,resolveFinal,reads=0;const actions=[];
 const sample=setup({request:async(action,id)=>{actions.push(action);if(action==='prepare')return {token:'fixture'};if(action==='start')return {id};return new Promise(resolve=>{resolveEnd=resolve;});},status:async()=>{reads++;return reads===1?{connected:true}:new Promise(resolve=>{resolveFinal=resolve;});}});
 await sample.session.start();await flush();assert.equal(sample.states.at(-1)[0],'connected');
 const stopping=sample.session.stop();
 assert.equal(sample.states.at(-1)[0],'error');assert.match(sample.states.at(-1)[1],/audio has stopped.*still being checked/);
 assert.equal(sample.device.destroyed,1);assert.equal(reads,1);assert.equal(actions.at(-1),'end');
 resolveEnd({});await flush();assert.equal(reads,2);assert.match(sample.states.at(-1)[1],/still being checked/);
 resolveFinal({status:'completed',ended:true});await stopping;assert.equal(sample.states.at(-1)[0],'ended');
 assert.deepEqual(actions,['prepare','start','end']);
}
console.log('PASS immediate stopped-audio UI while deferred end and final-status requests finish.');
