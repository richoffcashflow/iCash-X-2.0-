// Local provider receipts only: no calls, recordings, network or charges created.
import assert from 'node:assert/strict';
import {RecordingProviderError} from '../lib/required-call-recording-provider.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
const now=Date.now(),started=new Date(now-60000).toISOString(),ended=new Date(now-30000).toISOString();
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),rec='RE'+'c'.repeat(32);
const base={id:'11111111-1111-4111-8111-111111111111',account_id:'22222222-2222-4222-8222-222222222222',operation_key:'voice:33333333-3333-4333-8333-333333333333',provider_account_sid:ac,call_sid:ca,recording_sid:rec,conversation_id:'conv_fixture',state:'stopping',entry_policy:'direct_recorded_v1',recording_authorized_at:started,consent_at:null,start_claimed_at:started,provider_started_at:started,end_requested_at:ended,call_ended_at:ended,reconcile_lease_token:'44444444-4444-4444-8444-444444444444',next_reconcile_at:ended};
const receipt={sid:rec,call_sid:ca,account_sid:ac,status:'completed',start_time:started,duration:'30',price:null,price_unit:'USD'};
const warnings=[],originalWarn=console.warn;console.warn=(...args)=>warnings.push(args);
try{
 let finishes=[];
 const oldest={...base},newer={...base,id:'55555555-5555-4555-8555-555555555555'};
 const db=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?[oldest,newer]:[];
  if(path==='rpc/icash_finish_call_recording_work'){
   finishes.push(input);
   if(input.p_id===oldest.id&&input.p_outcome==='available')return null;
   if(input.p_outcome==='retry'){assert.equal(input.p_lease_token,oldest.reconcile_lease_token);oldest.next_reconcile_at=new Date(now+60000).toISOString();oldest.reconcile_lease_token=null;return oldest;}
   return {...newer,state:'available'};
  }
  throw Error('Unexpected fixture database request '+path);
 };
 const forbidden=async()=>{throw Error('No new provider work permitted');};
 const provider={getRecording:async()=>receipt,dial:forbidden,start:forbidden,register:forbidden,end:forbidden};
 assert.deepEqual(await maintainRecordings(db,provider,{TWILIO_ACCOUNT_SID:ac}),{deleted:0,reconciled:1,held:1});
 assert.deepEqual(finishes.map(x=>[x.p_id,x.p_outcome]),[[oldest.id,'available'],[oldest.id,'retry'],[newer.id,'available']]);
 assert(Date.parse(oldest.next_reconcile_at)>now);assert.equal(oldest.reconcile_lease_token,null,'Rejected receipt no longer leaves oldest due/leased forever');
 assert(warnings.some(x=>x[1]?.reason==='recording_receipt_not_saved'&&x[1]?.startMatches===true));
 // AI identity recovery is independent of a matched, completed carrier recording.
 finishes=[];const unbound={...base,state:'recording',conversation_id:null};
 const unboundDb=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?[unbound]:[];
  if(path==='rpc/icash_finish_call_recording_work'){finishes.push(input);return {...unbound,state:'available'};}
  throw Error('Unexpected fixture database request '+path);
 };
 assert.deepEqual(await maintainRecordings(unboundDb,{...provider,conversations:async()=>({has_more:false,conversations:[]})},{TWILIO_ACCOUNT_SID:ac}),{deleted:0,reconciled:1,held:0});
 assert.equal(finishes[0].p_outcome,'available');assert.equal(finishes[0].p_payload.durationSeconds,30);
 assert.equal(unbound.conversation_id,null,'No AI conversation fabricated');
 finishes=[];
 assert.equal((await maintainRecordings(unboundDb,{...provider,conversations:async()=>({has_more:false,conversations:[]}),getRecording:async()=>({...receipt,call_sid:'CA'+'d'.repeat(32)})},{TWILIO_ACCOUNT_SID:ac})).held,1);
 assert.deepEqual(finishes.map(x=>x.p_outcome),['retry'],'Wrong carrier recording never becomes available');
 // Diagnostics identify stages and fixed mismatch keys without logging provider data.
 const diagnose=async(overrides)=>{
  warnings.length=0;finishes=[];
  await maintainRecordings(unboundDb,{...provider,conversations:async()=>({has_more:false,conversations:[]}),...overrides},{TWILIO_ACCOUNT_SID:ac});
  assert.deepEqual(finishes.map(x=>x.p_outcome),['available'],'Diagnostics do not change independently verified audio');
  return warnings.find(x=>x[1]?.reason==='conversation_binding_pending')?.[1];
 };
 assert.equal((await diagnose({})).bindingStage,'list_empty');
 const failure=await diagnose({conversations:async()=>{throw new Error('secret-provider-body +15555550100');}});
 assert.equal(failure.bindingStage,'list_read');assert(!JSON.stringify(failure).includes('secret-provider-body'));assert(!JSON.stringify(failure).includes('+15555550100'));
 const unavailable=await diagnose({conversations:async()=>{throw new RecordingProviderError(403);}});
 assert.equal(unavailable.providerStatus,403);assert.deepEqual(unavailable.mismatches,[]);
 assert.equal((await diagnose({conversations:async()=>({has_more:true,conversations:[]})})).bindingStage,'list_shape');
 Object.assign(unbound,{agent_id:'agent_fixture',branch_id:'branch_fixture',version_id:'version_fixture',to_phone:'+15555550101',from_phone:'+15555550102'});
 const valid={conversation_id:'conv_fixture',agent_id:unbound.agent_id,branch_id:unbound.branch_id,version_id:unbound.version_id,user_id:'icash-recorded:'+unbound.id,metadata:{phone_call:{call_sid:ca,direction:'outbound',external_number:unbound.to_phone,agent_number:unbound.from_phone}},conversation_initiation_client_data:{user_id:'icash-recorded:'+unbound.id}};
 const cases=[['conversation',c=>c.conversation_id='wrong'],['agent',c=>c.agent_id='wrong'],['branch',c=>c.branch_id='wrong'],['version',c=>c.version_id='wrong'],['user',c=>{c.user_id='wrong';c.conversation_initiation_client_data.user_id='wrong';}],['carrierCall',c=>c.metadata.phone_call.call_sid='wrong'],['direction',c=>c.metadata.phone_call.direction='inbound'],['recipient',c=>c.metadata.phone_call.external_number='wrong'],['sender',c=>c.metadata.phone_call.agent_number='wrong'],['initiationUser',c=>delete c.conversation_initiation_client_data.user_id]];
 for(const [key,mutate] of cases){
  const value=structuredClone(valid);mutate(value);
  const diagnostic=await diagnose({conversations:async()=>({has_more:false,conversations:[{conversation_id:'conv_fixture'}]}),conversation:async()=>value});
  assert.equal(diagnostic.bindingStage,'identity_match');assert.deepEqual(diagnostic.mismatches,[key]);
  assert.deepEqual(Object.keys(diagnostic).sort(),['bindingStage','mismatches','reason','recordingId','stage']);
  assert(!JSON.stringify(diagnostic).includes(unbound.to_phone));assert(!JSON.stringify(diagnostic).includes('agent_fixture'));
 }
 console.log('PASS rejected receipt releases/requeues its lease, newer calls continue, missing AI identity does not hide verified audio, and cross-call receipts remain blocked.');
}finally{console.warn=originalWarn;}
