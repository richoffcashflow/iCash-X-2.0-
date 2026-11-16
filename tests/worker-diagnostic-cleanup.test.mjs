import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRpc,automationTick,workerFailureDetails} from '../worker/runner.mjs';
import {createScheduler} from '../worker/scheduler.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const privateDetail='private-database-payload-token';
function failureBody(mode){
 let cancelled=0,rejectCancel;
 const cleanup=new Promise((_,reject)=>{rejectCancel=reject;});
 // A real, unfinished stream exceeds the existing 4 KiB diagnostic limit.
 // No external database, provider or customer is contacted by this fixture.
 const response=new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode(privateDetail.repeat(200)));},
  cancel(){cancelled++;if(mode==='rejected')throw Error(privateDetail);return cleanup;},
 }),{status:503});
 if(mode==='synchronous'){
  const reader=response.body.getReader.bind(response.body);
  response.body.getReader=()=>{const actual=reader();actual.cancel=()=>{cancelled++;throw Error(privateDetail);};return actual;};
 }
 return {response,cancelled:()=>cancelled,reject:()=>rejectCancel(Error(privateDetail))};
}
async function promptly(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Known database failure blocked by diagnostic cleanup')),250);})]);}
 finally{clearTimeout(timer);}
}

await test('bounded worker DB diagnostics do not await pending, rejected or throwing cleanup',async()=>{
 for(const mode of ['pending','rejected','synchronous']){
  const fixture=failureBody(mode);let claims=0,sends=0;
  const rpc=createRpc('https://fixture.supabase.co','fixture-only',async()=>{claims++;return fixture.response;});
  await promptly(assert.rejects(automationTick(rpc,async()=>{sends++;assert.fail('A failed claim never dispatches');},'research'),error=>{
   assert.deepEqual(workerFailureDetails(error),{code:'SCREENING_DATABASE_UNAVAILABLE',operation:'icash_next_automation_lane',httpStatus:503});
   assert(!JSON.stringify(workerFailureDetails(error)).includes(privateDetail));return true;
  }));
  assert.equal(claims,1,'An unknown claim is never replayed');assert.equal(sends,0);
  assert.equal(fixture.cancelled(),1,'Cleanup starts exactly once');
  assert.equal(fixture.response.body.locked,false,'Diagnostic reader releases its lock');
  if(mode==='pending'){fixture.reject();await flush();}
 }
});

await test('diagnostic cleanup cannot turn one known scheduling failure into a watchdog stall',async()=>{
 const fixture=failureBody('pending');let at=0,claims=0,voice=0;
 const diagnostics=[];
 const rpc=createRpc('https://fixture.supabase.co','fixture-only',async()=>{claims++;return claims===1?fixture.response:Response.json(null);});
 const scheduler=createScheduler({now:()=>at,automationPools:['research','voice'],screening:async()=>false,
  automation:lane=>lane==='research'?automationTick(rpc,async()=>assert.fail('No fixture ticket was issued'),lane):(voice++,true),
  onFailure:(pool,error)=>diagnostics.push({pool,...workerFailureDetails(error)})});
 try{
  scheduler.run();await flush();
  at=250;scheduler.run();await flush();
  assert.equal(voice,1,'Independent voice selection continues');
  assert.equal(scheduler.health().body.automationInFlight,0,'Known failure has released its slot');
  assert.deepEqual(diagnostics,[{pool:'research',code:'SCREENING_DATABASE_UNAVAILABLE',operation:'icash_next_automation_lane',httpStatus:503}]);
  at=30000;scheduler.run();await flush();
  assert.equal(claims,2,'Only the normal bounded backoff permits a fresh poll');
  assert.equal(scheduler.health().body.status,'screening');
  at=270001;scheduler.run();await flush();
  assert.equal(scheduler.isStalled(),false,'Unsettled cleanup is not an active attempt');
  assert.equal(fixture.cancelled(),1);
  await promptly(scheduler.stop());
 }finally{fixture.reject();await flush();}
});

await test('complete diagnostic codes, malformed payloads and successful receipts retain their original boundaries',async()=>{
 for(const [response,code] of [
  [Response.json({code:'57014',message:privateDetail},{status:500}),'57014'],
  [Response.json({code:privateDetail},{status:503}),undefined],
  [new Response(privateDetail,{status:429}),undefined],
  [new Response(null,{status:401}),undefined],
 ]){
  let requests=0;
  const rpc=createRpc('https://fixture.supabase.co','fixture-only',async()=>{requests++;return response;});
  await assert.rejects(rpc('icash_next_automation_lane',{p_lane:'research'}),error=>{
   assert.deepEqual(workerFailureDetails(error),{code:'SCREENING_DATABASE_UNAVAILABLE',operation:'icash_next_automation_lane',httpStatus:response.status,...(code?{databaseCode:code}:{})});return true;
  });assert.equal(requests,1);
 }
 const rpc=createRpc('https://fixture.supabase.co','fixture-only',async()=>Response.json({token:'original-fixture-token'}));
 assert.deepEqual(await rpc('icash_next_automation_lane',{p_lane:'research'}),{token:'original-fixture-token'});
});
