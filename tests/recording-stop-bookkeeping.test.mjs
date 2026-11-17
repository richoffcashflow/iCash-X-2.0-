import assert from 'node:assert/strict';
import {recordingService} from '../lib/required-call-recording-service.ts';
import {recordingBaseUrl,sha} from '../lib/required-call-recording.ts';

const now=Date.parse('2026-11-17T00:00:00Z'),iso=new Date(now).toISOString();
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const call='CA'+'a'.repeat(32),carrier='AC'+'b'.repeat(32),recording='RE'+'c'.repeat(32),token='d'.repeat(64);
const request=(authorization=token,body={recordingId:id})=>new Request(recordingBaseUrl+'/stop',{
 method:'POST',headers:{authorization},body:JSON.stringify(body),
});
function fixture({reject=()=>false,failEnd=false,badEnd=false,mutate=()=>{},readFailure=false,missing=false}={}){
 const row={id,account_id:account,operation_key:'voice:'+id,provider_account_sid:carrier,call_sid:call,
  recording_sid:recording,state:'recording',stop_token_hash:sha(token),entry_policy:'direct_recorded_v1',
  consent_at:null,recording_authorized_at:iso,start_claimed_at:iso,provider_started_at:iso,created_at:iso,
  end_requested_at:null,call_ended_at:null};
 mutate(row);
 const writes=[],effects=[];
 const db=async(path,method,body)=>{
  if(path.startsWith('icash_call_recordings?')){
   if(readFailure)throw Error('synthetic read failure');
   return missing?[]:[structuredClone(row)];
  }
  assert.equal(path,'rpc/icash_transition_call_recording');
  assert.equal(body.p_id,id);assert.equal(body.p_account,account);assert.equal(body.p_operation,row.operation_key);
  writes.push(body.p_action);
  if(reject(body.p_action,writes))throw Error('synthetic bookkeeping failure');
  if(body.p_expected_state!==row.state)return null;
  if(body.p_action==='stop'){
   assert.equal(body.p_payload.stopTokenHash,row.stop_token_hash);
   row.state='stopping';row.end_requested_at??=iso;
  }else if(body.p_action==='call_ended'){
   assert.deepEqual(body.p_payload,{callSid:call,providerAccountSid:carrier,status:'completed'});
   if(!row.end_requested_at)return null;
   row.call_ended_at??=iso;
  }else if(body.p_action==='processing')row.state='processing';
  else assert.fail('Unexpected mutation '+body.p_action);
  return structuredClone(row);
 };
 const provider={
  end:async sid=>{assert.equal(sid,call);effects.push('end');if(failEnd)throw Error('synthetic carrier failure');return {sid:badEnd?'CA'+'e'.repeat(32):call,account_sid:carrier,status:'completed'};},
  stop:async(sid,rid)=>{assert.equal(sid,call);assert.equal(rid,recording);effects.push('stop');return {sid:recording,call_sid:call,account_sid:carrier,status:'stopped'};},
 };
 return {row,writes,effects,service:recordingService({}, {db,provider,now:()=>now})};
}

// Reproduce the former short-circuit: a failed intent write prevented hangup.
{
 const f=fixture({reject:(action,writes)=>action==='stop'&&writes.length===1});
 const response=await f.service.stop(request());
 assert.equal(response.status,200);assert.equal((await response.json()).callEnded,true);
 assert.deepEqual(f.effects,['end']);assert(f.row.end_requested_at);assert(f.row.call_ended_at);
}
// A confirmed carrier end remains true even when every intent or receipt write
// fails. Missing database receipts stay missing for ordinary reconciliation.
for(const action of ['stop','call_ended','processing']){
 const f=fixture({reject:attempt=>attempt===action});
 const response=await f.service.stop(request());
 assert.equal(response.status,200,action);const body=await response.json();
 assert.equal(body.callEnded,true,action);assert.equal(body.stopped,true,action);
 assert.deepEqual(f.effects,['end']);
 if(action==='stop'){assert.equal(f.row.end_requested_at,null);assert.equal(f.row.call_ended_at,null);}
 if(action==='call_ended'){assert(f.row.end_requested_at);assert.equal(f.row.call_ended_at,null);}
}
for(const options of [{failEnd:true},{badEnd:true}]){
 const f=fixture(options),response=await f.service.stop(request());
 assert.equal(response.status,503);const body=await response.json();
 assert.equal(body.callEnded,false);assert.equal(body.stopped,true);
 assert.deepEqual(f.effects,['end','stop']);assert(f.row.end_requested_at);assert.equal(f.row.call_ended_at,null);
}
// Persistence tolerance begins only after the existing exact capability and
// recording authorization checks; never guess a call after failed lookup.
for(const options of [
 {missing:true},{mutate:r=>r.stop_token_hash=sha('e'.repeat(64))},
 {mutate:r=>r.call_sid=null},{mutate:r=>r.recording_authorized_at=null},
 {mutate:r=>r.created_at=new Date(now-21*60000).toISOString()},
]){
 const f=fixture(options),response=await f.service.stop(request());
 assert.equal(response.status,401);assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
}
for(const invalid of [request('invalid'),request(token,{recordingId:id,callSid:call}),request(token,{recordingId:'invalid'})]){
 const f=fixture(),response=await f.service.stop(invalid);
 assert([400,401].includes(response.status));assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
}
{
 const f=fixture({readFailure:true}),response=await f.service.stop(request());
 assert.equal(response.status,503);assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
}
console.log('PASS exact-call stop survives bookkeeping failure, preserves carrier uncertainty and rejects unauthenticated termination; offline fixtures only.');
