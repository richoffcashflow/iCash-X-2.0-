import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {voiceMeteringTick,voiceMeteringPass,createVoiceMeteringScheduler,withVoiceMeteringHealth} from '../worker/voice-metering.mjs';
import {createRpc} from '../worker/runner.mjs';

const tokens=['a','b','c'].map(c=>`${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}`.repeat(2));
const endpoint='https://www.geticashx.com/api/internal/voice/metering';
const meterToken=n=>`${n.toString(16).padStart(8,'0')}-1111-1111-1111-111111111111`.repeat(2);
const flushPromises=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};

// Empty/disabled DB policy is safe before app activation and never sends HTTP.
let claims=0,requests=0;
assert.equal(await voiceMeteringTick(async(name,args,options)=>{
 claims++;assert.equal(name,'icash_next_voice_metering');assert.deepEqual(args,{});
 assert(options.signal instanceof AbortSignal);return null;
},async()=>{requests++;throw Error('must not send');}),false);
assert.equal(claims,1);assert.equal(requests,0);

// Destination and credentials are fixed, not provided by a ticket or environment.
const deadline=new AbortController();
assert.equal(await voiceMeteringTick(async(_name,_args,options)=>{
 assert.equal(options.signal,deadline.signal);return {token:tokens[0]};
},async(url,options)=>{
 requests++;assert.equal(url,endpoint);
 assert.deepEqual(options,{method:'POST',headers:{Authorization:'Bearer '+tokens[0]},redirect:'error',signal:deadline.signal});
 return new Response(null,{status:200});
},{signal:deadline.signal}),true);
for(const invalid of [undefined,false,0,'',[],{}, {token:tokens[0].toUpperCase()},
 {token:tokens[0]+'\n'}, {token:'Bearer '+tokens[0]}, {token:tokens[0],url:'https://elsewhere.invalid'},
 {token:tokens[0],credentials:'not-allowed'}]){
 await assert.rejects(voiceMeteringTick(async()=>invalid,async()=>{throw Error('invalid ticket dispatched');}),/INVALID_VOICE_METERING_TICKET/);
}
assert.equal(requests,1);
await assert.rejects(voiceMeteringTick(async()=>({token:tokens[0]}),async()=>new Response(null,{status:503})),/VOICE_METERING_HELD/);

// An ambiguous response consumes no client retry: only a fresh DB claim can retry.
let issued=0;const used=[];
const uncertain=async(_url,options)=>{used.push(options.headers.Authorization);throw Error('ambiguous provider timeout');};
const claim=async()=>({token:tokens[issued++]});
await assert.rejects(voiceMeteringTick(claim,uncertain),/ambiguous provider timeout/);
await assert.rejects(voiceMeteringTick(claim,uncertain),/ambiguous provider timeout/);
assert.equal(issued,2);assert.deepEqual(used,tokens.slice(0,2).map(token=>'Bearer '+token));

// A claim finishing after deadline cannot dispatch its now-uncertain ticket.
const expired=new AbortController();let expiredDispatches=0;
await assert.rejects(voiceMeteringTick(async()=>{
 expired.abort();return {token:tokens[0]};
},async()=>{expiredDispatches++;return new Response(null);},{signal:expired.signal}),{name:'AbortError'});
assert.equal(expiredDispatches,0);

// Verify the production RPC allowlist and shared deadline, using mocked fetch only.
const rpcRequests=[];
const rpc=createRpc('https://fixture.supabase.co','fixture-key',async(url,options)=>{
 rpcRequests.push({url,options});return new Response(JSON.stringify({token:tokens[0]}));
});
const rpcDeadline=new AbortController();
assert.equal(await voiceMeteringTick(rpc,async()=>new Response(null),{signal:rpcDeadline.signal}),true);
assert.equal(rpcRequests.length,1);
assert.equal(rpcRequests[0].url.pathname,'/rest/v1/rpc/icash_next_voice_metering');
assert.equal(rpcRequests[0].options.body,'{}');
assert.equal(rpcRequests[0].options.signal.aborted,false);
rpcDeadline.abort();assert.equal(rpcRequests[0].options.signal.aborted,true);
await assert.rejects(rpc('unsupported_operation',{}),/Unsupported worker operation/);

// Fixed 10-second start-to-start cadence, even when idle or a previous claim fails.
let time=0,laneClaims=0,fail=false,failureReports=0;
const budgets=[];
const lane=createVoiceMeteringScheduler({now:()=>time,timeoutSignal:ms=>{budgets.push(ms);return new AbortController().signal;},
 rpc:async()=>{laneClaims++;time+=3000;if(fail)throw Error('secret must not reach log');return null;},
 onFailure:(...args)=>{assert.deepEqual(args,[]);failureReports++;}});
assert.deepEqual(lane.health(),{code:200,body:{voiceMetering:'starting'}});
assert.equal(await lane.run(),7000);assert.equal(laneClaims,1);
assert.equal(lane.health().body.voiceMetering,'available');
assert.equal(await lane.run(),7000);assert.equal(laneClaims,1,'early checks must not mint extra tickets');
time=10000;assert.equal(await lane.run(),7000);
fail=true;
for(const at of [20000,30000,40000]){
 time=at;
 assert.equal(await lane.run(),7000);
}
assert.equal(failureReports,3);assert.equal(lane.health().code,503);
assert.equal(lane.health().body.voiceMetering,'held');
assert.deepEqual(lane.health(false),{code:200,body:{voiceMetering:'standby'}});
fail=false;time=50000;assert.equal(await lane.run(),7000);assert.equal(lane.health().code,200);
assert.equal(lane.health().body.voiceMetering,'available');
assert(budgets.every(ms=>ms===8000),'the claim and endpoint share one 8-second budget');
time+=30001;assert.equal(lane.health().code,503);
await lane.run();assert.equal(lane.health().code,200,'successful null claims restore liveness');

// In-flight work never overlaps. Cancellation covers the claim, not just HTTP.
const pendingDeadline=new AbortController();let pendingClaims=0;
const pending=createVoiceMeteringScheduler({timeoutSignal:()=>pendingDeadline.signal,rpc:async(_name,_args,{signal})=>{
 pendingClaims++;
 return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
}});
const inFlight=pending.run();
await assert.rejects(pending.run(),/VOICE_METERING_LOOP_ALREADY_RUNNING/);
assert.equal(pendingClaims,1);pendingDeadline.abort();await inFlight;
assert.equal(pending.health().body.voiceMetering,'held');

// Twelve due calls, not one, are processed in a single pass. With mocked 1s
// endpoint latency they complete in three waves before the shared 8s deadline.
// This proves bounded scheduling behavior, not real provider throughput.
let manyTime=0,manyClaims=0,manyInFlight=0,manyPeak=0;
const manyPending=[],manyUsed=[],manyDeadline=new AbortController(),manyBudgets=[];
const many=createVoiceMeteringScheduler({now:()=>manyTime,timeoutSignal:ms=>{manyBudgets.push(ms);return manyDeadline.signal;},
 rpc:async(name,args,{signal})=>{
  assert.equal(name,'icash_next_voice_metering');assert.deepEqual(args,{});assert.equal(signal,manyDeadline.signal);
  return ++manyClaims<=12?{token:meterToken(manyClaims)}:null;
 },transport:async(url,options)=>{
  assert.equal(url,endpoint);assert.equal(options.signal,manyDeadline.signal);assert.equal(options.body,undefined);
  manyUsed.push(options.headers.Authorization);manyPeak=Math.max(manyPeak,++manyInFlight);
  return new Promise(resolve=>manyPending.push(()=>{manyInFlight--;resolve(new Response(null));}));
 }});
const manyRun=many.run();await flushPromises();
for(const at of [1000,2000,3000]){
 assert.equal(manyInFlight,4);assert.equal(manyPending.length,4);
 manyTime=at;manyPending.splice(0).forEach(resolve=>resolve());await flushPromises();
}
assert.equal(await manyRun,7000);assert.equal(manyClaims,13);
assert.equal(manyUsed.length,12);assert.equal(new Set(manyUsed).size,12);assert.equal(manyPeak,4);
assert.deepEqual(manyBudgets,[8000]);assert.equal(many.health().body.voiceMetering,'available');

// A large backlog cannot create unbounded work. Full batches hold health until
// a later pass actually observes empty; each next pass claims fresh tickets.
let capTime=0,capClaims=0,capFailures=0;const capUsed=[];
const capacity=createVoiceMeteringScheduler({now:()=>capTime,rpc:async()=>++capClaims<=45?{token:meterToken(capClaims)}:null,
 transport:async(_url,options)=>{capUsed.push(options.headers.Authorization);return new Response(null);},onFailure:()=>capFailures++});
await capacity.run();assert.equal(capClaims,20);assert.equal(capUsed.length,20);assert.equal(capacity.health().body.voiceMetering,'held');
capTime=10000;await capacity.run();assert.equal(capClaims,40);assert.equal(capUsed.length,40);assert.equal(capacity.health().body.voiceMetering,'held');
capTime=20000;await capacity.run();assert.equal(capClaims,46);assert.equal(capUsed.length,45);assert.equal(capacity.health().body.voiceMetering,'available');
assert.equal(capFailures,2);assert.equal(new Set(capUsed).size,45);
let capped=0;
await assert.rejects(voiceMeteringPass(async()=>({token:meterToken(++capped)}),async()=>new Response(null)),/VOICE_METERING_CAPACITY_REACHED/);
assert.equal(capped,20);

// Shared expiry aborts all active requests, starts no more claims, and does not
// let another pass overlap even if cancellation takes time to settle. Recovery
// obtains new tickets instead of replaying any of the four uncertain ones.
let timeoutTime=0,timeoutClaims=0,recovery=false,timeoutSignal=new AbortController();
const timeoutUsed=[],abortRejections=[];
const timed=createVoiceMeteringScheduler({now:()=>timeoutTime,timeoutSignal:()=>timeoutSignal.signal,
 rpc:async(_name,_args,{signal})=>{
  assert.equal(signal,timeoutSignal.signal);return ++timeoutClaims<=8?{token:meterToken(timeoutClaims)}:null;
 },transport:async(_url,options)=>{
  timeoutUsed.push(options.headers.Authorization);assert.equal(options.signal,timeoutSignal.signal);
  if(recovery)return new Response(null);
  return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>abortRejections.push(()=>reject(options.signal.reason)),{once:true}));
 }});
const timedRun=timed.run();await flushPromises();assert.equal(timeoutClaims,4);
timeoutTime=8000;timeoutSignal.abort();await flushPromises();
assert.equal(abortRejections.length,4);assert.equal(timeoutClaims,4);
await assert.rejects(timed.run(),/VOICE_METERING_LOOP_ALREADY_RUNNING/);
abortRejections.forEach(reject=>reject());assert.equal(await timedRun,2000);
assert.equal(timed.health().body.voiceMetering,'held');
timeoutTime=10000;timeoutSignal=new AbortController();recovery=true;await timed.run();
assert.equal(timeoutClaims,9);assert.equal(timeoutUsed.length,8);assert.equal(new Set(timeoutUsed).size,8);
assert.equal(timed.health().body.voiceMetering,'available');

// A single failed endpoint also stops fresh claims while its already-started
// siblings drain, instead of returning early and overlapping the next pass.
let failureClaims=0,failureSettled=false;const failureRequests=[];
const failurePass=voiceMeteringPass(async()=>({token:meterToken(++failureClaims)}),async()=>new Promise((resolve,reject)=>failureRequests.push({resolve,reject})))
 .then(()=>{throw Error('failed pass must not succeed');},error=>{failureSettled=true;assert.match(error.message,/VOICE_METERING_PASS_HELD/);});
await flushPromises();assert.equal(failureClaims,4);
failureRequests[0].reject(Error('uncertain failure'));await flushPromises();
assert.equal(failureClaims,4);assert.equal(failureSettled,false);
failureRequests.slice(1).forEach(({resolve})=>resolve(new Response(null)));await failurePass;
assert.equal(failureClaims,4);

const healthy={code:200,body:{status:'screening',outreachEnabled:false,automation:'available'}};
assert.deepEqual(withVoiceMeteringHealth(healthy,{code:503,body:{voiceMetering:'held'}}),{
 code:503,body:{status:'degraded',outreachEnabled:false,automation:'available',voiceMetering:'held'},
});
assert.equal(withVoiceMeteringHealth({code:503,body:{...healthy.body,status:'degraded'}},{code:200,body:{voiceMetering:'available'}}).code,503);
assert.equal(withVoiceMeteringHealth(healthy,{code:200,body:{voiceMetering:'starting'}}).body.status,'degraded','startup must not advertise metering readiness before a successful claim');

// Exercise index.mjs itself: no HTTP server or external network is opened. Its
// metering timer must keep firing while the original automation request waits 55s.
const original={fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,
 setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,now:Date.now,
 createServer:http.createServer,on:process.on};
const originalEnv={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY,SCREENING_WORKER_ENABLED:process.env.SCREENING_WORKER_ENABLED};
let indexTime=0,indexClaims=0,resolveAutomation,serverHandler,serverClosed=false;
const timers=new Map(),intervals=new Map(),signalHandlers=new Map();let timerId=0;
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
try{
 process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SECRET_KEY='fixture-key';process.env.SCREENING_WORKER_ENABLED='true';
 Date.now=()=>indexTime;
 globalThis.setTimeout=(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;};
 globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.setInterval=(fn,delay)=>{const id=++timerId;intervals.set(id,{fn,delay});return id;};
 globalThis.clearInterval=id=>intervals.delete(id);
 http.createServer=handler=>{serverHandler=handler;return {listen(_port,_host,callback){callback();},close(){serverClosed=true;}};};
 process.on=function(signal,fn){if(signal==='SIGTERM'||signal==='SIGINT'){signalHandlers.set(signal,fn);return this;}return original.on.call(this,signal,fn);};
 globalThis.fetch=async(url,options)=>{
  const target=String(url);
  if(target==='https://www.geticashx.com/api/internal/automation')return new Promise(resolve=>{resolveAutomation=resolve;});
  assert(target.startsWith('https://fixture.supabase.co/rest/v1/rpc/'));
  if(target.endsWith('/icash_next_voice_metering')){indexClaims++;return new Response('null');}
  if(target.endsWith('/icash_next_automation'))return new Response(JSON.stringify({token:tokens[0]}));
  if(target.endsWith('/icash_record_service_heartbeat'))assert.equal(JSON.parse(options.body).p_component,'worker');
  else assert(target.endsWith('/icash_claim_screening'));
  return new Response('null');
 };
 await import('../worker/index.mjs');await flush();
 assert.equal(typeof resolveAutomation,'function');assert.equal(indexClaims,1);
 assert.equal(timers.size,1,'only metering is scheduled while automation is in flight');
 for(const at of [10000,20000,30000,40000,50000]){
  indexTime=at;
  const [id,timer]=[...timers][0];assert.equal(timer.delay,10000);timers.delete(id);
  await timer.fn();
 }
 assert.equal(indexClaims,6,'metering must not be starved by a 55-second automation attempt');
 let healthCode,healthBody;
 serverHandler({url:'/health'},{writeHead(code){healthCode=code;},end(body){healthBody=JSON.parse(body);}});
 assert.equal(healthCode,200);assert.equal(healthBody.voiceMetering,'available');assert.equal(healthBody.automation,'available');
 indexTime=55000;resolveAutomation(new Response(null));await flush();
 assert.equal(timers.size,2,'the original scheduler resumes independently');
 signalHandlers.get('SIGTERM')();assert.equal(serverClosed,true);
 assert.equal(timers.size,0);assert.equal(intervals.size,0);
}finally{
 globalThis.fetch=original.fetch;globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;
 globalThis.setInterval=original.setInterval;globalThis.clearInterval=original.clearInterval;Date.now=original.now;
 http.createServer=original.createServer;process.on=original.on;
 for(const [key,value] of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
assert.match(readFileSync(new URL('../worker/Dockerfile',import.meta.url),'utf8'),/node --experimental-strip-types tests\/voice-metering-worker\.test\.mjs/);
console.log('PASS voice metering worker: dedicated 10-second lane, bounded 20-ticket/four-request drain, many-call throughput, shared timeout, saturation health, fixed endpoint, one-use tickets, strict claims, nonoverlap and shutdown; all network/server calls mocked.');
