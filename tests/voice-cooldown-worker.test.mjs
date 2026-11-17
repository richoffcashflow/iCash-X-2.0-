// Offline protocol and scheduler fixtures. No database or provider is contacted.
import assert from 'node:assert/strict';
import {automationTick,createRpc,workerFailureDetails,WorkerOperationError} from '../worker/runner.mjs';
import {createScheduler} from '../worker/scheduler.mjs';
import {automationPools} from '../worker/pools.mjs';
import {createHeartbeat} from '../worker/heartbeat.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const hint=(retryAfterMs=500)=>({status:'voice_cooldown',retryAfterMs});
const token=letter=>`${letter.repeat(8)}-${letter.repeat(4)}-${letter.repeat(4)}-${letter.repeat(4)}-${letter.repeat(12)}`.repeat(2);
const noDispatch=async()=>assert.fail('A tokenless response must never reach automation dispatch');
const dbFailure=()=>new WorkerOperationError('SCREENING_DATABASE_UNAVAILABLE','icash_poll_voice_ticket',500,'57014');

// The new contract is separate from the old RPC; ordinary lanes keep their
// original endpoint and every hint remains disjoint from a spending capability.
for(const delay of [100,500,1100]){
 const calls=[];
 const result=await automationTick(async(name,args)=>{calls.push({name,args});return hint(delay);},noDispatch,'voice');
 assert.deepEqual(calls,[{name:'icash_poll_voice_ticket',args:{}}]);
 assert.deepEqual(result,hint(delay));assert.notEqual(result,true,'A hint is not completed customer work');
}
for(const lane of [undefined,'general','research','messages','recovery']){
 const calls=[];
 assert.equal(await automationTick(async(name,args)=>{calls.push({name,args});return null;},noDispatch,lane),false);
 assert.deepEqual(calls,[lane===undefined?{name:'icash_next_automation',args:{}}:{name:'icash_next_automation_lane',args:{p_lane:lane}}]);
 await assert.rejects(automationTick(async()=>hint(),noDispatch,lane),/INVALID_AUTOMATION_TICKET/);
}
assert.equal(await automationTick(async()=>null,noDispatch,'voice'),false);
const malformed=[
 {...hint(),token:token('a')},{status:'voice_cooldown'},{retryAfterMs:500},
 {...hint(),extra:true},{status:'other',retryAfterMs:500},
 ...[0,99,1101,-1,500.5,'500',null,NaN,Infinity,-Infinity].map(hint),
];
for(const value of malformed)await assert.rejects(automationTick(async()=>value,noDispatch,'voice'),/INVALID_AUTOMATION_TICKET/);

// Exercise the real RPC operation allowlist and fixed diagnostics. Even a
// known missing endpoint is an ordinary failure, never a second issuer call.
{
 const requests=[];
 const rpc=createRpc('https://fixture.supabase.co','offline-fixture',async(url,options)=>{
  requests.push({path:url.pathname,method:options.method,body:JSON.parse(options.body)});
  assert.equal(options.redirect,'error');return Response.json(hint());
 });
 assert.deepEqual(await automationTick(rpc,noDispatch,'voice'),hint());
 assert.deepEqual(requests,[{path:'/rest/v1/rpc/icash_poll_voice_ticket',method:'POST',body:{}}]);
}
for(const mode of ['timeout','body-failure','missing-rpc']){
 let requests=0;
 const rpc=createRpc('https://fixture.supabase.co','offline-fixture',async()=>{
  requests++;
  if(mode==='timeout')throw new DOMException('private request details','TimeoutError');
  if(mode==='body-failure')return new Response(new ReadableStream({start(controller){controller.error(Error('private body details'));}}));
  return Response.json({code:'PGRST202',details:'private schema details'},{status:404});
 });
 await assert.rejects(automationTick(rpc,noDispatch,'voice'),error=>{
  const details=workerFailureDetails(error);
  assert.equal(details.code,'SCREENING_DATABASE_UNAVAILABLE');assert.equal(details.operation,'icash_poll_voice_ticket');
  assert.equal(mode==='missing-rpc'?details.databaseCode:details.requestCode,mode==='missing-rpc'?'PGRST202':mode==='timeout'?'REQUEST_TIMEOUT':'REQUEST_FAILED');
  assert(!JSON.stringify(details).includes('private'));return true;
 });
 assert.equal(requests,1,'An uncertain or unavailable new RPC cannot fall back to the old issuer');
}
{
 let claims=0;const sent=[];
 const rpc=async(name,args)=>{assert.equal(name,'icash_poll_voice_ticket');assert.deepEqual(args,{});return {token:token(++claims===1?'a':'b')};};
 const transport=async(url,options)=>{
  assert.equal(url,'https://www.geticashx.com/api/internal/automation');sent.push(options.headers.Authorization);
  throw new DOMException('unknown provider outcome','TimeoutError');
 };
 await assert.rejects(automationTick(rpc,transport,'voice'),error=>workerFailureDetails(error).code==='AUTOMATION_HELD');
 assert.equal(claims,1);assert.equal(sent.length,1);
 await assert.rejects(automationTick(rpc,transport,'voice'));
 assert.deepEqual(sent,['Bearer '+token('a'),'Bearer '+token('b')],'Later work needs a fresh capability; no original is replayed');
}

const step=async(scheduler,clock,at)=>{clock.value=at;scheduler.run();await flush();};
// A hint preserves the previous true-idle count: false after one earlier idle
// still waits ten seconds, instead of being incorrectly reset to five seconds.
{
 const clock={value:0},started=[],results=[false,hint(),false,false];
 const scheduler=createScheduler({now:()=>clock.value,automationPools:['voice'],screening:async()=>false,
  automation:async()=>{started.push(clock.value);return results.shift()??false;}});
 for(const at of [0,4999,5000,5499,5500,15499,15500])await step(scheduler,clock,at);
 assert.deepEqual(started,[0,5000,5500,15500]);
 await scheduler.stop();
}
// Pool-wide waits cannot wake a sibling before its true-idle/error deadline.
for(const initial of ['idle','error']){
 const clock={value:0},started=[];let calls=0;
 const scheduler=createScheduler({now:()=>clock.value,automationPools:['voice','voice'],screening:async()=>false,
  automation:async()=>{started.push(clock.value);calls++;if(calls===1&&initial==='error')throw dbFailure();return calls===2?hint(1000):false;}});
 for(let at=0;at<=5000;at+=50)await step(scheduler,clock,at);
 assert.deepEqual(started,initial==='idle'?[0,250,1250,5000]:[0,250,1250]);
 assert.equal(scheduler.health().body.status,initial==='error'?'degraded':'screening');
 await scheduler.stop();
}
// Two existing in-flight reads may return hints out of order. A later short
// hint cannot shorten the shared deadline established by the earlier result.
{
 const clock={value:0},started=[],resolvers=[];
 const scheduler=createScheduler({now:()=>clock.value,automationPools:['voice','voice'],screening:async()=>false,
  automation:()=>{started.push(clock.value);return started.length<=2?new Promise(resolve=>resolvers.push(resolve)):Promise.resolve(false);}});
 await step(scheduler,clock,0);await step(scheduler,clock,250);
 assert.equal(scheduler.health().body.automationInFlight,2);
 clock.value=500;resolvers[0](hint(1100));await flush();
 clock.value=550;resolvers[1](hint(100));await flush();
 await step(scheduler,clock,1599);assert.deepEqual(started,[0,250]);
 await step(scheduler,clock,1600);assert.deepEqual(started,[0,250,1600]);
 await scheduler.stop();
}
// Successful hint observations clear consecutive transport failures exactly
// like null, but do not erase the recurring-failure monitor or its heartbeat.
{
 const clock={value:0},started=[];let calls=0;
 const scheduler=createScheduler({now:()=>clock.value,automationPools:['voice'],screening:async()=>false,
  automation:async()=>{started.push(clock.value);if(++calls%2)throw dbFailure();return hint();}});
 for(const at of [0,29999,30000,30500,60500,61000,91000])await step(scheduler,clock,at);
 assert.deepEqual(started,[0,30000,30500,60500,61000,91000]);
 assert.deepEqual(scheduler.health().body.recurringSchedulerFailurePools,['voice']);
 assert.equal(scheduler.health().body.status,'degraded');assert.equal(scheduler.health().code,200);
 assert.equal(scheduler.health().body.automation,'available','A completed read clears the consecutive-failure slot hold');
 const beats=[];const heartbeat=createHeartbeat({now:()=>clock.value,health:()=>scheduler.health(),rpc:async(name,args)=>beats.push({name,args})});
 await heartbeat();assert.equal(beats.at(-1).args.p_status,'degraded');
 await scheduler.stop();
}
// Malformed internal outcomes are errors with ordinary backoff, including a
// valid-looking hint returned by a non-voice pool. They never become success.
for(const [pool,value] of [['voice',{...hint(),token:token('a')}],['voice',hint(NaN)],['research',hint()]]){
 const clock={value:0},started=[],errors=[];
 const scheduler=createScheduler({now:()=>clock.value,automationPools:[pool],screening:async()=>false,
  automation:async()=>{started.push(clock.value);return value;},onFailure:(lane,error)=>errors.push({lane,message:error.message})});
 await step(scheduler,clock,0);await step(scheduler,clock,29999);assert.deepEqual(started,[0]);
 assert.deepEqual(errors,[{lane:pool,message:'INVALID_WORKER_OUTCOME'}]);assert.equal(scheduler.health().body.status,'degraded');
 await step(scheduler,clock,30000);assert.deepEqual(started,[0,30000]);
 await scheduler.stop();
}
{
 const clock={value:0};let resolve,calls=0;
 const scheduler=createScheduler({now:()=>clock.value,automationPools:['voice'],screening:async()=>false,
  automation:()=>{calls++;return new Promise(done=>{resolve=done;});}});
 await step(scheduler,clock,0);const draining=scheduler.stop();
 resolve(hint());await draining;
 await step(scheduler,clock,10000);assert.equal(calls,1,'Shutdown drains the known read without issuing replacement work');
 assert.equal(scheduler.health().body.automationInFlight,0);
}

// Compare the real scheduler with two response protocols. In legacy mode the
// same simulated one-second DB cooldown returns false, exactly as the old RPC
// did; in hint mode it exits before queue work. Timing is deliberately zero
// latency and is evidence of the reproduced path, not production throughput.
async function simulate({count=16,protocol='hint',mode='backlog',duration=60000}){
 let time=0,last=-Infinity,heavy=0,cheap=0;
 const starts=[],issued=[];
 const scheduler=createScheduler({now:()=>time,automationPools:automationPools({ICASH_AUTOMATION_CONCURRENCY:String(count)}),screening:async()=>false,
  automation:async pool=>{
   starts.push({at:time,pool});if(pool!=='voice')return false;
   const cooldown=time>=last&&time-last<=1000;
   if(protocol==='hint'&&cooldown){cheap++;return hint(Math.max(100,Math.min(1100,Math.ceil(last+1000-time)+25)));}
   heavy++;
   if(!cooldown&&mode!=='empty'&&(mode!=='closes'||time<30000)){last=time;issued.push(time);return true;}
   return false;
  }});
 while(time<duration){scheduler.run();await flush();const delay=scheduler.run();await flush();time+=Math.max(1,delay);}
 await scheduler.stop();
 assert(starts.slice(1).every((start,index)=>start.at-starts[index].at>=250),'All pools keep the global 250 ms start stagger');
 assert(issued.slice(1).every((at,index)=>at-issued[index]>1000),'The original strict global issuance gate still wins');
 assert.deepEqual(new Set(starts.map(x=>x.pool)),new Set(automationPools({ICASH_AUTOMATION_CONCURRENCY:String(count)})),'Other pool families receive their turns');
 return {starts,issued,heavy,cheap,maxGap:issued.length>1?Math.max(...issued.slice(1).map((at,index)=>at-issued[index])):0};
}
const summaries=[];
for(const count of [8,16]){
 const old=await simulate({count,protocol:'legacy'}),current=await simulate({count});
 assert(current.issued.length>old.issued.length);assert(current.maxGap<old.maxGap);
 assert(current.cheap<=current.issued.length+1,'The shared cooldown permits at most one cheap recheck per issued turn in this serial fixture');
 assert(current.heavy<=current.issued.length+1,'No cooldown starts expensive queue work');
 assert(current.starts.length<=240,'No more than four total automation starts per second');
 const emptyOld=await simulate({count,protocol:'legacy',mode:'empty',duration:300000});
 const emptyCurrent=await simulate({count,mode:'empty',duration:300000});
 assert.deepEqual(emptyCurrent,emptyOld,'Five minutes of empty/overnight scheduling are byte-for-byte unchanged');
 assert.equal(emptyCurrent.cheap,0);assert.equal(emptyCurrent.issued.length,0);
 const closed=await simulate({count,mode:'closes',duration:90000});
 assert(closed.issued.every(at=>at<30000));
 const later=closed.starts.filter(x=>x.pool==='voice'&&x.at>=60000).map(x=>x.at);
 assert(later.length<=(count===16?8:4),'A closed queue returns to ordinary per-slot idle polling');
 summaries.push({count,oldIssued:old.issued.length,newIssued:current.issued.length,oldHeavy:old.heavy,newHeavy:current.heavy,cheap:current.cheap,oldMaxGap:old.maxGap,newMaxGap:current.maxGap,emptyFiveMinuteHeavy:emptyCurrent.heavy});
}
console.log('PASS voice cooldown worker: strict tokenless protocol, no replay/fallback, both monitoring paths, original idle/error backoff, shared waits, fairness and shutdown. Offline simulations:',JSON.stringify(summaries));
