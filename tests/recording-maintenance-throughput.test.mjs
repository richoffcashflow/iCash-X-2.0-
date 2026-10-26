// Synthetic receipt processing only. No network, new calls or charges.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {RecordingProviderError} from '../lib/required-call-recording-provider.ts';
const account='AC'+'a'.repeat(32),at=new Date(Date.now()-60000).toISOString();
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=n=>({id:uuid(n),account_id:uuid(1000+n),operation_key:'voice:'+uuid(n),provider_account_sid:account,
 call_sid:'CA'+n.toString(16).padStart(32,'0'),recording_sid:'RE'+n.toString(16).padStart(32,'0'),conversation_id:'conv_fixture_'+n,
 state:'available',start_claimed_at:at,provider_started_at:at,end_requested_at:at,call_ended_at:at,
 reconcile_lease_token:uuid(2000+n),deletion_lease_token:uuid(3000+n)});
function fixture({deletions=0,failRead=null,failWrite=null,controller=null}={}){
 const records=Array.from({length:12},(_,i)=>row(i+1)),removals=Array.from({length:deletions},(_,i)=>row(100+i));
 const byRecording=new Map([...records,...removals].map(r=>[r.recording_sid,r]));
 const claims=[],finishes=[],reads=[],deletes=[],gone=new Set();let active=0,peak=0;
 const enter=async fn=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setImmediate(resolve));return await fn();}finally{active--;}};
 const db=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work'){
   claims.push(input);assert.equal(input.p_lease_seconds,120);
   assert.equal(input.p_limit,input.p_kind==='delete'?5:12);
   return input.p_kind==='delete'?removals:records;
  }
  assert.equal(path,'rpc/icash_finish_call_recording_work');finishes.push(input);
  const current=[...records,...removals].find(r=>r.id===input.p_id);assert(current);
  assert.equal(input.p_account,current.account_id);assert.equal(input.p_operation,current.operation_key);
  assert.equal(input.p_lease_token,current[input.p_kind==='delete'?'deletion_lease_token':'reconcile_lease_token']);
  if(input.p_id===failWrite)throw Error('Fixture database unavailable');
  return {...current,state:input.p_outcome};
 };
 const forbidden=async()=>{throw Error('New calls, recordings and charges are forbidden in this fixture');};
 const provider={dial:forbidden,start:forbidden,register:forbidden,end:forbidden,
  getRecording:async id=>{
   reads.push(id);if(controller&&!controller.signal.aborted)controller.abort();
   return enter(()=>{if(id===failRead)throw new RecordingProviderError(403);const r=byRecording.get(id);assert(r);
    return {sid:id,call_sid:r.call_sid,account_sid:account,status:gone.has(id)?'deleted':'completed',start_time:at,duration:'20',price:null,price_unit:'USD'};});
  },
  deleteRecording:async id=>enter(()=>{assert(removals.some(r=>r.recording_sid===id),'only already-claimed expired retention work can delete');deletes.push(id);gone.add(id);})};
 return {records,claims,finishes,reads,deletes,get peak(){return peak;},run:options=>maintainRecordings(db,provider,{TWILIO_ACCOUNT_SID:account},options)};
}
test('twelve original receipts and retention work finish with at most three active rows',async()=>{
 const f=fixture({deletions:5});assert.deepEqual(await f.run(),{deleted:5,reconciled:12,held:0});
 assert.equal(f.peak,3);assert.equal(f.claims.length,2);assert.equal(f.deletes.length,5);
 assert.equal(f.finishes.length,17);assert.equal(new Set(f.finishes.map(x=>x.p_id)).size,17);
 for(const r of f.records)assert.equal(f.reads.filter(x=>x===r.recording_sid).length,1,'no receipt read is retried');
});
test('a failed receipt preserves its hold without blocking later recordings',async()=>{
 const f=fixture({failRead:row(1).recording_sid});assert.deepEqual(await f.run(),{deleted:0,reconciled:11,held:1});
 assert.equal(f.peak,3);assert.equal(f.reads.length,12);
 assert.equal(f.finishes.find(x=>x.p_id===uuid(1)).p_outcome,'retry');
 assert.equal(f.finishes.filter(x=>x.p_outcome==='available').length,11);
});
test('deadline stops unstarted provider work and preserves each original lease for retry',async()=>{
 const controller=new AbortController(),f=fixture({controller});
 const result=await f.run({signal:controller.signal});
 assert.equal(f.reads.length,1);assert.deepEqual(result,{deleted:0,reconciled:1,held:11});
 assert.equal(f.finishes.filter(x=>x.p_outcome==='retry'&&x.p_payload.reason==='maintenance_deadline_reached').length,11);
 assert.equal(f.deletes.length,0);
});
test('an expired deadline claims nothing',async()=>{
 const controller=new AbortController();controller.abort();const f=fixture();
 assert.deepEqual(await f.run({signal:controller.signal}),{deleted:0,reconciled:0,held:0});
 assert.equal(f.claims.length,0);assert.equal(f.reads.length,0);assert.equal(f.finishes.length,0);
});
test('database failure remains visible after unrelated rows finish',async()=>{
 const f=fixture({failWrite:uuid(1)});
 await assert.rejects(f.run(),/RECORDING_MAINTENANCE_INCOMPLETE/);
 assert.equal(f.reads.length,12);assert.equal(f.finishes.filter(x=>x.p_id!==uuid(1)&&x.p_outcome==='available').length,11);
});
