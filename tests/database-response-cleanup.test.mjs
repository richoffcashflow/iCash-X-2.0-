import assert from 'node:assert/strict';
import {test} from 'node:test';
import {db} from '../lib/stripe-test.ts';
import {recoverOwnerActiveExports} from '../lib/owner-active-export.ts';
import {ProspectingBudgetError,VoiceActivationBudgetError,SellerInventoryUnavailableError} from '../lib/voice-budget-failure.ts';

// Native streams and in-process fixtures only. No database or provider network.
const nativeFetch=globalThis.fetch;
const originalEnv=Object.fromEntries(['SUPABASE_URL','SUPABASE_SECRET_KEY','DEALMACHINE_API_KEY'].map(key=>[key,process.env[key]]));
Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEY:'fixture-only',DEALMACHINE_API_KEY:'dm_sk_live_fixture'});
function unfinished(status=503,mode='pending'){
 let cancelled=0,rejectCancel;
 const cleanup=new Promise((_,reject)=>{rejectCancel=reject;});
 const response=new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode('ignored private failure body'));},
  cancel(){cancelled++;if(mode==='rejected')throw Error('private cleanup failure');return cleanup;},
 }),{status});
 if(mode==='synchronous')Object.defineProperty(response.body,'cancel',{value(){cancelled++;throw Error('private synchronous cleanup failure');}});
 return {response,cancelled:()=>cancelled,reject:()=>rejectCancel(Error('private delayed cleanup failure'))};
}
async function promptly(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Known outcome blocked by response cleanup')),1000);})]);}
 finally{clearTimeout(timer);}
}
try{
 await test('database rejection proceeds while cleanup hangs, rejects, or throws',async()=>{
  for(const mode of ['pending','rejected','synchronous']){
   const fixture=unfinished(503,mode);let requests=0;
   globalThis.fetch=async()=>{requests++;return fixture.response;};
   await promptly(assert.rejects(db('rpc/fixture','POST',{}),{message:'Database request failed'}));
   assert.equal(requests,1,'Cleanup never replays the database write');
   assert.equal(fixture.cancelled(),1,'Cleanup starts exactly once');
   if(mode==='pending'){
    fixture.reject();
    // The test runner also rejects unhandled promise rejections. Observe a
    // later turn so an eventual cancellation failure cannot escape silently.
    await new Promise(resolve=>setImmediate(resolve));
   }
  }
 });

 await test('financial admission classifications and successful receipts remain exact',async()=>{
  const cases=[
   ['rpc/icash_reserve_operation',{code:'P0001',message:'Prospecting budget reached',details:JSON.stringify({quoteCents:977})},error=>error instanceof ProspectingBudgetError&&error.quoteCents===977],
   ['rpc/icash_reserve_paced_voice',{code:'P0001',message:'Activation spending cap reached'},error=>error instanceof VoiceActivationBudgetError],
   ['rpc/icash_claim_text',{code:'P0001',message:'Seller inventory assigned or suppressed'},error=>error instanceof SellerInventoryUnavailableError],
   ['rpc/fixture',{code:'P0001',message:'Prospecting budget reached',details:JSON.stringify({quoteCents:977})},error=>error.message==='Database request failed'&&!(error instanceof ProspectingBudgetError)],
  ];
  for(const [path,body,check] of cases){
   let requests=0;globalThis.fetch=async()=>{requests++;return Response.json(body,{status:400});};
   await promptly(assert.rejects(db(path,'POST',{}),check));assert.equal(requests,1);
  }
  globalThis.fetch=async()=>Response.json({receipt:'original',usage:null});
  assert.deepEqual(await db('rpc/fixture','POST',{}),{receipt:'original',usage:null});
  globalThis.fetch=async()=>new Response(null,{status:204});
  assert.equal(await db('rpc/fixture','POST',{}),null);
 });

 await test('original export receipt recovery reports persistence failure without waiting on DB cleanup',async()=>{
  const fixture=unfinished();let databaseRequests=0,providerReads=0;const attempted=[];
  globalThis.fetch=async(url,init)=>{
   databaseRequests++;assert.equal(url,'https://fixture.invalid/rest/v1/rpc/icash_record_owner_export_recovery');
   assert.equal(init.method,'POST');attempted.push(JSON.parse(init.body));return fixture.response;
  };
  const account='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002';
  const saved={id:batch,accountId:account,createdAt:'2026-11-01T00:00:00Z',items:[],preview:{},request:{people_ids:['per_1']},
   receipt:{httpStatus:200,raw:{export_id:'export-fixture',record_count:1}},recovery:null,csv:null,lease:'original-fixture-lease'};
  const receipt={data:{export_id:'export-fixture',status:'completed',record_count:1,download_urls:[{url:'https://storage.googleapis.com/fixture.csv'}]}};
  const recoveryDb=async(path,method,body)=>{
   if(path==='rpc/icash_claim_owner_export_recovery')return structuredClone(saved);
   if(path==='rpc/icash_take_dealmachine_request'||path==='rpc/icash_finish_dealmachine_request')return true;
   if(path==='rpc/icash_record_owner_export_recovery')return db(path,method,body);
   throw Error('Unexpected fixture database path');
  };
  const result=await promptly(recoverOwnerActiveExports(recoveryDb,async(url,init)=>{
   providerReads++;assert.equal(url,'https://api.v2.dealmachine.com/v1/exports/export-fixture');
   assert.equal(init.method,'GET');return Response.json(receipt);
  }));
  assert.deepEqual(result,{status:'export_recovery_unavailable'});
  assert.equal(providerReads,1,'Only the original export GET was attempted');
  assert.equal(databaseRequests,1,'Receipt persistence is not retried after an unknown failure');
  assert.equal(fixture.cancelled(),1);
  assert.equal(attempted[0].p_batch,batch);assert.equal(attempted[0].p_lease,saved.lease);
  assert.deepEqual(attempted[0].p_receipt.raw,receipt);
  assert.equal(saved.csv,null,'No artifact, contacts, costs or completion can be invented');
  fixture.reject();await new Promise(resolve=>setImmediate(resolve));
 });
}finally{
 globalThis.fetch=nativeFetch;
 for(const[key,value]of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
