// Offline fault injection only: no carrier, customer or database requests.
import assert from 'node:assert/strict';
import test from 'node:test';
import {timingSafeEqual} from 'node:crypto';
import {maintainRecordedReception} from '../lib/recorded-reception-maintenance.ts';
import {privateHeaders} from '../lib/required-call-recording.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const account='AC'+'a'.repeat(32),secret='offline-maintenance-secret'.padEnd(40,'x');
const env={TWILIO_ACCOUNT_SID:account,CRON_SECRET:secret,ICASH_RECORDED_RECEPTION_SCHEMA_READY:'true'};
const request=()=>new Request('https://example.test/api/reception/recorded/maintenance',{headers:{authorization:'Bearer '+secret}});
const row=n=>({id:'session_'+n,account_id:'account_'+n,operation_key:'original_'+n,provider_account_sid:account,
 recording_sid:'RE'+String(n).repeat(32),call_sid:'CA'+String(n).repeat(32),deletion_lease_token:'delete_'+n,reconcile_lease_token:'reconcile_'+n,row_version:1});

for(const failure of ['null','throw'])test(`lost incoming deletion retry write (${failure}) stays observable after other claims finish`,async()=>{
 const deletions=[row(1),row(2)],reconciliation={...row(3),provider_account_sid:'AC'+'f'.repeat(32)};
 const originals=structuredClone([...deletions,reconciliation]),finishes=[],reads=[],deletes=[];
 const rpc=async(name,body)=>{
  if(name==='icash_claim_recorded_reception_work')return structuredClone(body.p_kind==='delete'?deletions:[reconciliation]);
  if(name==='icash_get_recorded_reception_session')return structuredClone(originals.find(r=>r.id===body.p_id));
  if(name==='icash_finish_recorded_reception_work'){
   finishes.push(body);
   const current=originals.find(r=>r.id===body.p_id);
   assert.equal(body.p_account,current.account_id);assert.equal(body.p_operation,current.operation_key);
   assert.equal(body.p_lease_token,current[body.p_kind==='delete'?'deletion_lease_token':'reconcile_lease_token']);
   if(body.p_id===deletions[0].id){if(failure==='throw')throw Error('private write failure');return null;}
   return structuredClone(current);
  }
  throw Error('UNEXPECTED_RPC');
 };
 const provider={getRecording:async sid=>{
  reads.push(sid);const current=deletions.find(r=>r.recording_sid===sid);
  return {sid,account_sid:account,call_sid:current.call_sid,status:deletes.includes(sid)?'deleted':'completed'};
 },deleteRecording:async sid=>{deletes.push(sid);}};
 await assert.rejects(maintainRecordedReception(rpc,provider,env),{message:'RECORDED_RECEPTION_MAINTENANCE_INCOMPLETE'});
 assert.equal(finishes.filter(x=>x.p_id===deletions[0].id&&x.p_outcome==='retry').length,1,'One durable retry attempt, never a provider replay');
 assert(finishes.some(x=>x.p_id===deletions[1].id&&x.p_outcome==='deleted'),'Later independent deletion completes');
 assert(finishes.some(x=>x.p_id===reconciliation.id&&x.p_outcome==='retry'),'Independent reconciliation keeps its original hold');
 assert.deepEqual(deletes,deletions.map(r=>r.recording_sid));assert.equal(reads.length,4);
 assert.deepEqual([...deletions,reconciliation],originals,'Original source records remain unchanged');
});

test('lost incoming reconciliation retry is not reported as healthy',async()=>{
 const original={...row(3),provider_account_sid:'AC'+'f'.repeat(32)};let finishes=0;
 const rpc=async(name,body)=>{
  if(name==='icash_claim_recorded_reception_work')return body.p_kind==='reconcile'?[original]:[];
  if(name==='icash_get_recorded_reception_session')return original;
  if(name==='icash_finish_recorded_reception_work'){finishes++;assert.equal(body.p_outcome,'retry');return null;}
  throw Error('UNEXPECTED_RPC');
 };
 await assert.rejects(maintainRecordedReception(rpc,{},env),{message:'RECORDED_RECEPTION_MAINTENANCE_INCOMPLETE'});
 assert.equal(finishes,1);
});

const loadRoute=dependencies=>loadService('app/api/reception/recorded/maintenance/route.ts',{
 privateHeaders,timingSafeEqual,process:{env},db:async()=>{throw Error('UNEXPECTED_DB');},
 createRecordedReceptionProviders:()=>({}),maintainRecordedReception:async()=>({deleted:0,reconciled:0,settled:0,held:2}),
 maintainCustomerPhoneCalls:async()=>({checked:0,settled:0,held:0,errors:0,deleted:0}),...dependencies,
});
for(const failure of ['throw','returned_errors'])test(`customer-phone recovery ${failure} cannot be hidden by successful reception maintenance`,async()=>{
 const route=await loadRoute({maintainCustomerPhoneCalls:async()=>{if(failure==='throw')throw Error('private customer phone failure');return {errors:1};}});
 const response=await route.GET(request());assert.equal(response.status,503);
 assert.equal(response.headers.get('cache-control'),privateHeaders['Cache-Control']);
 assert.deepEqual(await response.json(),{status:'recorded_reception_maintenance_needs_review'});
});

test('failed incoming lane waits for already-started customer-phone recovery before returning',async()=>{
 let release,started=false,finished=false,returned=false;
 const customerDone=new Promise(resolve=>{release=resolve;});
 const route=await loadRoute({maintainRecordedReception:async()=>{throw Error('private original failure');},
  maintainCustomerPhoneCalls:async()=>{started=true;await customerDone;finished=true;return {errors:0};}});
 const pending=route.GET(request()).then(response=>{returned=true;return response;});
 await new Promise(resolve=>setImmediate(resolve));assert(started);assert.equal(returned,false,'Do not abandon an independent in-flight recovery');
 release();const response=await pending;assert(finished);assert.equal(response.status,503);
});

test('ordinary durable holds do not become infrastructure failures',async()=>{
 const response=await (await loadRoute()).GET(request());assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{deleted:0,reconciled:0,settled:0,held:2});
});
