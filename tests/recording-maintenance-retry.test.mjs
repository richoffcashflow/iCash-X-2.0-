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
 assert.deepEqual(finishes.filter(x=>x.p_id===oldest.id).map(x=>x.p_outcome),['available','retry']);
 assert.deepEqual(finishes.filter(x=>x.p_id===newer.id).map(x=>x.p_outcome),['available'],'unrelated rows may finish concurrently');
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
 // A batch still processes every recording when the bounded handoff diagnostic fails.
 const batch=[{...unbound,nonce_hash:'a'.repeat(64)},{...unbound,id:'77777777-7777-4777-8777-777777777777',nonce_hash:'a'.repeat(64)}];let carrierReads=0;
 const batchDb=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?batch:[];
  if(path==='rpc/icash_finish_call_recording_work'){assert.equal(input.p_outcome,'available');return {...batch.find(x=>x.id===input.p_id),state:'available'};}
  throw Error('Unexpected database mutation '+path);
 };
 assert.deepEqual(await maintainRecordings(batchDb,{...provider,conversations:async()=>({has_more:false,conversations:[]}),getCall:async()=>{carrierReads++;throw new RecordingProviderError(403);}},{TWILIO_ACCOUNT_SID:ac}),{deleted:0,reconciled:2,held:0});
 assert.equal(carrierReads,1,'Only one diagnostic carrier read per invocation, no retry');
 // A lost recording-start receipt cannot hide an independently ended carrier.
 // These are synthetic reads/transitions only: never dial, start, end or charge.
 const terminalRecovery=async({call={},rowChanges={},list={recordings:[],next_page_uri:null},providerError=null,rejectAction=null}={})=>{
  let row={...base,state:'starting',recording_sid:null,conversation_id:null,provider_started_at:null,end_requested_at:null,call_ended_at:null,
   from_phone:'+15555550101',to_phone:'+15555550102',stop_token_hash:'e'.repeat(64),...rowChanges};
  const transitions=[],finishes=[],reads=[],mutations=[];
  const fixtureDb=async(path,method,input)=>{
   if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?[structuredClone(row)]:[];
   if(path==='rpc/icash_call_credit_available')return true;
   if(path==='rpc/icash_transition_call_recording'){
    assert.equal(input.p_id,row.id);assert.equal(input.p_account,row.account_id);assert.equal(input.p_operation,row.operation_key);
    transitions.push(input.p_action);if(input.p_action===rejectAction)return null;
    if(input.p_action==='stop'){assert.deepEqual(input.p_payload,{stopTokenHash:row.stop_token_hash});row={...row,state:'stopping',end_requested_at:ended};}
    else if(input.p_action==='call_ended'){assert(row.end_requested_at);assert.deepEqual(input.p_payload,{callSid:ca,providerAccountSid:ac,status:call.status??'completed'});row={...row,call_ended_at:ended};}
    else throw Error('Unexpected transition');
    return {...row};
   }
   if(path==='rpc/icash_finish_call_recording_work'){finishes.push(input);return {...row};}
   throw Error('Unexpected recovery mutation '+path);
  };
  const deny=async()=>{mutations.push('forbidden');throw Error('No provider mutations permitted');};
  const fixtureProvider={getCall:async id=>{assert.equal(id,row.call_sid);reads.push('call');if(providerError)throw providerError;return {sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'completed',...call};},
   listRecordings:async id=>{assert.equal(id,ca);reads.push('recordings');return list;},dial:deny,start:deny,end:deny,register:deny};
  const result=await maintainRecordings(fixtureDb,fixtureProvider,{TWILIO_ACCOUNT_SID:ac});
  assert.deepEqual(mutations,[]);assert(finishes.every(x=>['retry','available'].includes(x.p_outcome)));
  return {row,result,transitions,finishes,reads};
 };
 for(const status of ['completed','failed','busy','no-answer','canceled']){
  const r=await terminalRecovery({call:{status}});
  assert.deepEqual(r.transitions,['stop','call_ended']);assert.equal(r.row.call_ended_at,ended);
  assert.deepEqual(r.reads,['call','recordings']);assert.deepEqual(r.result,{deleted:0,reconciled:0,held:1});
  assert.equal(r.finishes[0].p_outcome,'retry','Missing audio remains unresolved without retaining ended-call capacity');
  assert.equal(r.row.recording_sid,null);assert.equal(r.row.conversation_id,null);
 }
 for(const call of [{status:'in-progress'},{status:'ringing'},{status:'queued'},{status:undefined},
  {sid:'CA'+'f'.repeat(32)},{account_sid:'AC'+'f'.repeat(32)},{from:'+15555550199'},{to:'+15555550199'},{direction:'inbound'},
  {from:undefined},{to:undefined}]){
  const r=await terminalRecovery({call});assert.deepEqual(r.transitions,[]);assert.equal(r.row.call_ended_at,null);
 }
 const missingSid=await terminalRecovery({rowChanges:{call_sid:null}});assert.deepEqual(missingSid.reads,[]);assert.deepEqual(missingSid.transitions,[]);
 const unavailableCall=await terminalRecovery({providerError:new RecordingProviderError(503)});assert.deepEqual(unavailableCall.transitions,[]);assert.deepEqual(unavailableCall.reads,['call']);
 for(const rejectAction of ['stop','call_ended']){
  const r=await terminalRecovery({rejectAction});assert.equal(r.row.call_ended_at,null);assert.deepEqual(r.reads,['call']);assert.equal(r.finishes[0].p_outcome,'retry');
 }
 const recoveredAudio=await terminalRecovery({list:{recordings:[receipt],next_page_uri:null}});
 assert.deepEqual(recoveredAudio.transitions,['stop','call_ended']);assert.equal(recoveredAudio.finishes[0].p_outcome,'available');assert.equal(recoveredAudio.finishes[0].p_payload.durationSeconds,30);
 assert.equal(recoveredAudio.result.reconciled,1,'A later verified audio receipt remains recoverable');
 console.log('PASS rejected receipt releases/requeues its lease, newer calls continue, missing AI identity does not hide verified audio, and cross-call receipts remain blocked.');
}finally{console.warn=originalWarn;}
