import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {db} from '../lib/stripe-test.ts';
import {ProspectingBudgetError} from '../lib/voice-budget-failure.ts';
import {automationTick,workerFailureDetails} from '../worker/runner.mjs';
import {loadService} from './helpers/simulated-journey-services.mjs';

const auth=await loadService('lib/account-auth.ts',{});
const nativeFetch=globalThis.fetch;
process.env.SUPABASE_URL='https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY='fixture-only';
const token='00000000-0000-4000-8000-000000000001'.repeat(2);
function unreadResponse(status,{ack=false,rejectCleanup=false}={}){
 let cancelled=0;
 const response=new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode('private ignored response'));},
  cancel(){cancelled++;if(rejectCleanup)throw Error('private cleanup failure');},
 }),{status,headers:ack?{'x-icash-automation-outcome':'job-held'}:{}});
 return {response,cancelled:()=>cancelled};
}

await test('database rejections release unread bodies without changing financial classification',async()=>{
 let requests=0;
 try{
  for(const status of [400,401,403,429,500,503])for(const rejectCleanup of [false,true]){
   const fixture=unreadResponse(status,{rejectCleanup});
   globalThis.fetch=async()=>{requests++;return fixture.response;};
   await assert.rejects(db('rpc/fixture','POST',{}),{message:'Database request failed'});
   assert.equal(fixture.cancelled(),1,`HTTP ${status} releases its response`);
  }
  assert.equal(requests,12,'No database request is retried');
  globalThis.fetch=async()=>Response.json({code:'P0001',message:'Prospecting budget reached',details:JSON.stringify({quoteCents:977})},{status:400});
  await assert.rejects(db('rpc/icash_reserve_operation','POST',{}),error=>error instanceof ProspectingBudgetError&&error.quoteCents===977);
  globalThis.fetch=async()=>Response.json({saved:true});
  assert.deepEqual(await db('rpc/fixture','POST',{}),{saved:true},'Successful receipts are still read');
 }finally{globalThis.fetch=nativeFetch;}
});

await test('authentication releases rejected responses and preserves status for session recovery',async()=>{
 let requests=0;
 try{
  for(const status of [400,401,403,429,500])for(const rejectCleanup of [false,true]){
   const fixture=unreadResponse(status,{rejectCleanup});
   globalThis.fetch=async()=>{requests++;return fixture.response;};
   await assert.rejects(auth.authRequest('user'),error=>error instanceof auth.AuthRequestError&&error.status===status&&error.message==='Account authentication unavailable');
   assert.equal(fixture.cancelled(),1);
  }
  assert.equal(requests,10,'No authentication request is retried');
  globalThis.fetch=async()=>Response.json({id:'verified-fixture'});
  assert.deepEqual(await auth.authRequest('user'),{id:'verified-fixture'});
 }finally{globalThis.fetch=nativeFetch;}
});

await test('worker releases every unused response without replacing the durable dispatch outcome',async()=>{
 for(const [status,ack,success] of [[200,false,true],[202,false,true],[503,true,true],[503,false,false],[500,true,false]])for(const rejectCleanup of [false,true]){
  let claims=0,dispatches=0;
  const fixture=unreadResponse(status,{ack,rejectCleanup});
  const run=()=>automationTick(async()=>{claims++;return {token};},async()=>{dispatches++;return fixture.response;},'voice');
  if(success)assert.equal(await run(),true);
  else await assert.rejects(run(),error=>{
   assert.deepEqual(workerFailureDetails(error),{code:'AUTOMATION_HELD',operation:'automation_dispatch',httpStatus:status});return true;
  });
  assert.equal(fixture.cancelled(),1);
  assert.equal(claims,1);assert.equal(dispatches,1,'Cleanup never replays the one-use capability');
 }
 assert.equal(await automationTick(async()=>({token}),async()=>new Response(null,{status:204}),'voice'),true);
});

await test('native HTTP streams close promptly after DB/auth errors and a completed worker dispatch',async()=>{
 // Local fixture only. A real server leaves each body unfinished; the caller
 // must release it instead of waiting for garbage collection or its deadline.
 let status=503,requests=0,closed;
 const server=http.createServer((_request,response)=>{
  requests++;
  response.on('close',()=>closed?.());
  response.writeHead(status,{'Content-Type':'text/plain'});
  response.write('private fixture body stays open');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const oldUrl=process.env.SUPABASE_URL;
 try{
  process.env.SUPABASE_URL=origin;
  for(const kind of ['database','authentication','worker']){
   let timer;
   const connectionClosed=new Promise(resolve=>{closed=resolve;});
   status=kind==='worker'?200:503;
   if(kind==='database')await assert.rejects(db('fixture'),{message:'Database request failed'});
   if(kind==='authentication')await assert.rejects(auth.authRequest('user'),error=>error instanceof auth.AuthRequestError&&error.status===503);
   if(kind==='worker')assert.equal(await automationTick(async()=>({token}),async(_url,init)=>nativeFetch(origin+'/automation',init),'voice'),true);
   try{
    await Promise.race([connectionClosed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${kind} left its response connection open`)),1000);})]);
   }finally{clearTimeout(timer);}
  }
  assert.equal(requests,3,'Each operation is sent exactly once');
 }finally{
  process.env.SUPABASE_URL=oldUrl;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
