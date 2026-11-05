// Synthetic receipt processing only. No network, new calls or charges.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {RecordingProviderError} from '../lib/required-call-recording-provider.ts';
const account='AC'+'a'.repeat(32),at=new Date(Date.now()-60000).toISOString();
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=n=>({id:uuid(n),account_id:uuid(1000+n),operation_key:'voice:'+uuid(n),provider_account_sid:account,
 call_sid:'CA'+n.toString(16).padStart(32,'0'),recording_sid:'RE'+n.toString(16).padStart(32,'0'),conversation_id:'conv_fixture_'+n,
 state:'available',start_claimed_at:at,provider_started_at:at,end_requested_at:at,call_ended_at:at,
 reconcile_lease_token:uuid(2000+n),deletion_lease_token:uuid(3000+n)});
function fixture({deletions=0,recordCount=12,failRead=null,failWrite=null,controller=null,abortAfter=null,failClaim=null}={}){
 const records=Array.from({length:recordCount},(_,i)=>row(i+1)),removals=Array.from({length:deletions},(_,i)=>row(100+i));
 const byRecording=new Map([...records,...removals].map(r=>[r.recording_sid,r]));
 const claims=[],finishes=[],reads=[],deletes=[],gone=new Set();let active=0,peak=0,claimed=0,reconcileClaims=0;
 const enter=async fn=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setImmediate(resolve));return await fn();}finally{active--;}};
 const db=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work'){
   claims.push(input);assert.equal(input.p_lease_seconds,120);
   assert.equal(input.p_limit,input.p_kind==='delete'?5:12);
   if(input.p_kind==='delete')return removals;
   reconcileClaims++;if(reconcileClaims===failClaim)throw Error('Fixture claim unavailable');
   const batch=records.slice(claimed,claimed+input.p_limit);claimed+=batch.length;return batch;
  }
  assert.equal(path,'rpc/icash_finish_call_recording_work');finishes.push(input);
  const current=[...records,...removals].find(r=>r.id===input.p_id);assert(current);
  assert.equal(input.p_account,current.account_id);assert.equal(input.p_operation,current.operation_key);
  assert.equal(input.p_lease_token,current[input.p_kind==='delete'?'deletion_lease_token':'reconcile_lease_token']);
  if(input.p_id===failWrite)throw Error('Fixture database unavailable');
  if(controller&&finishes.length===abortAfter)controller.abort();
  return {...current,state:input.p_outcome};
 };
 const forbidden=async()=>{throw Error('New calls, recordings and charges are forbidden in this fixture');};
 const provider={dial:forbidden,start:forbidden,register:forbidden,end:forbidden,
  getRecording:async id=>{
   reads.push(id);if(controller&&abortAfter===null&&!controller.signal.aborted)controller.abort();
   return enter(()=>{if(id===failRead)throw new RecordingProviderError(403);const r=byRecording.get(id);assert(r);
    return {sid:id,call_sid:r.call_sid,account_sid:account,status:gone.has(id)?'deleted':'completed',start_time:at,duration:'20',price:null,price_unit:'USD'};});
  },
  deleteRecording:async id=>enter(()=>{assert(removals.some(r=>r.recording_sid===id),'only already-claimed expired retention work can delete');deletes.push(id);gone.add(id);})};
 return {records,claims,finishes,reads,deletes,db,provider,get peak(){return peak;},run:options=>maintainRecordings(db,provider,{TWILIO_ACCOUNT_SID:account},options)};
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
test('production drain catches up on original results without increasing concurrency or repeating work',async()=>{
 const f=fixture({recordCount:60,deletions:5});
 assert.deepEqual(await f.run({drain:true}),{deleted:5,reconciled:48,held:0});
 assert.equal(f.peak,3);assert.equal(f.claims.filter(x=>x.p_kind==='delete').length,1);
 assert.equal(f.claims.filter(x=>x.p_kind==='reconcile').length,4);
 assert.equal(f.finishes.length,53);assert.equal(new Set(f.finishes.map(x=>x.p_id)).size,53);
 assert.equal(f.reads.filter(id=>f.records.some(r=>r.recording_sid===id)).length,48);
});
test('a partial queue stops draining, and a failed receipt cannot starve a later batch',async()=>{
 const f=fixture({recordCount:27,failRead:row(1).recording_sid});
 assert.deepEqual(await f.run({drain:true}),{deleted:0,reconciled:26,held:1});
 assert.equal(f.claims.filter(x=>x.p_kind==='reconcile').length,3);assert.equal(f.peak,3);
 assert.equal(f.finishes.find(x=>x.p_id===uuid(1)).p_outcome,'retry');
});
test('a deadline between batches leaves later work unclaimed',async()=>{
 const controller=new AbortController(),f=fixture({recordCount:36,controller,abortAfter:12});
 assert.deepEqual(await f.run({drain:true,signal:controller.signal}),{deleted:0,reconciled:12,held:0});
 assert.equal(f.claims.filter(x=>x.p_kind==='reconcile').length,1);assert.equal(f.reads.length,12);
});
test('database failures preserve completed results and stop further drain claims',async()=>{
 const f=fixture({recordCount:36,failWrite:uuid(1)});
 await assert.rejects(f.run({drain:true}),/RECORDING_MAINTENANCE_INCOMPLETE/);
 assert.equal(f.claims.filter(x=>x.p_kind==='reconcile').length,1);
 assert.equal(f.finishes.filter(x=>x.p_id!==uuid(1)&&x.p_outcome==='available').length,11);
 const failedClaim=fixture({recordCount:36,failClaim:2});
 await assert.rejects(failedClaim.run({drain:true}),/Fixture claim unavailable/);
 assert.equal(failedClaim.finishes.length,12);assert.equal(failedClaim.reads.length,12);
});
test('authenticated production maintenance actually uses the drain and the shared provider deadline',async()=>{
 const f=fixture({recordCount:27}),secret='fixture-maintenance-secret-'.repeat(2);
 const priorSecret=process.env.CRON_SECRET,priorAccount=process.env.TWILIO_ACCOUNT_SID;
 process.env.CRON_SECRET=secret;process.env.TWILIO_ACCOUNT_SID=account;
 let providerSignal;
 globalThis.__recordingDrainFixture={db:f.db,createRecordingProviders:(_env,_fetch,signal)=>{providerSignal=signal;return f.provider;}};
 try{
  let source=await readFile(new URL('../app/api/internal/voice/recording/maintenance/route.ts',import.meta.url),'utf8');
  source=source.replace("import {db} from '@/lib/stripe-test';",'const {db}=globalThis.__recordingDrainFixture;')
   .replace("import {createRecordingProviders} from '@/lib/required-call-recording-provider';",'const {createRecordingProviders}=globalThis.__recordingDrainFixture;')
   .replace("'@/lib/required-call-recording-maintenance'",JSON.stringify(new URL('../lib/required-call-recording-maintenance.ts',import.meta.url).href))
   .replace("'@/lib/required-call-recording'",JSON.stringify(new URL('../lib/required-call-recording.ts',import.meta.url).href));
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const route=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
  assert.equal((await route.POST(new Request('https://fixture.invalid/maintenance'))).status,401);
  assert.equal(f.claims.length,0,'unauthenticated requests cannot claim provider work');
  const response=await route.GET(new Request('https://fixture.invalid/maintenance',{headers:{authorization:'Bearer '+secret}}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:0,reconciled:27,held:0});
  assert.equal(f.peak,3);assert(providerSignal instanceof AbortSignal);assert.equal(providerSignal.aborted,false);
 }finally{
  if(priorSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=priorSecret;
  if(priorAccount===undefined)delete process.env.TWILIO_ACCOUNT_SID;else process.env.TWILIO_ACCOUNT_SID=priorAccount;
  delete globalThis.__recordingDrainFixture;
 }
});
