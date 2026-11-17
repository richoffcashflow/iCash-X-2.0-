import assert from 'node:assert/strict';
import {recordedReceptionService} from '../lib/recorded-reception-service.ts';
import {recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {sha} from '../lib/required-call-recording.ts';

const now=Date.parse('2026-11-17T00:00:00Z'),iso=new Date(now).toISOString();
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const call='CA'+'a'.repeat(32),carrier='AC'+'b'.repeat(32),recording='RE'+'c'.repeat(32),token='d'.repeat(64);
const request=authorization=>new Request(recordedReceptionUrl+'/stop',{
 method:'POST',headers:{authorization:authorization??token},body:JSON.stringify({recordingId:id}),
});
function fixture({reject=()=>false,failEnd=false,badCanonical=false}={}){
 const row={id,account_id:account,operation_key:'recorded-reception:'+call,provider_account_sid:carrier,
  call_sid:call,recording_sid:recording,row_version:1,state:'recording',stop_token_hash:sha(token),
  from_phone:'+12125550101',to_phone:'+12125550102',entry_policy:'direct_recorded_v1',
  recording_authorized_at:iso,start_claimed_at:iso,created_at:iso,call_started_at:iso,
  end_requested_at:null,call_ended_at:null};
 let status='in-progress';const writes=[],effects=[];
 const rpc=async(name,body)=>{
  if(name==='icash_get_recorded_reception_session')return structuredClone(row);
  assert.equal(name,'icash_transition_recorded_reception');
  assert.equal(body.p_id,id);assert.equal(body.p_account,account);assert.equal(body.p_operation,row.operation_key);
  writes.push(body.p_action);if(reject(body.p_action))throw Error('synthetic bookkeeping failure');
  if(body.p_expected_version!==row.row_version)return null;
  if(body.p_action==='stop'||body.p_action==='request_end'){
   if(body.p_action==='stop')assert.equal(body.p_payload.stopTokenHash,row.stop_token_hash);
   row.end_requested_at??=iso;row.state='stopping';
  }else if(body.p_action==='call_ended'){
   if(!row.end_requested_at)return null;
   assert.equal(body.p_payload.callSid,call);assert.equal(body.p_payload.providerAccountSid,carrier);
   assert.equal(body.p_payload.fromPhone,row.from_phone);assert.equal(body.p_payload.toPhone,row.to_phone);
   assert.equal(body.p_payload.direction,'inbound');assert.equal(body.p_payload.status,'completed');
   row.call_ended_at=iso;
  }else assert.fail('Unexpected mutation '+body.p_action);
  row.row_version++;return structuredClone(row);
 };
 const provider={
  getCall:async sid=>{assert.equal(sid,call);return {sid:call,account_sid:carrier,
   from:badCanonical?'+12125550999':row.from_phone,to:row.to_phone,direction:'inbound',status,start_time:iso};},
  end:async sid=>{assert.equal(sid,call);effects.push('end');if(failEnd)throw Error('synthetic carrier failure');status='completed';return {sid:call,account_sid:carrier,status};},
  stop:async(sid,rid)=>{assert.equal(sid,call);assert.equal(rid,recording);effects.push('stop');return {sid:recording,call_sid:call,account_sid:carrier,status:'stopped'};},
 };
 return {row,writes,effects,service:recordedReceptionService({}, {rpc,provider,now:()=>now})};
}

// The stop-intent RPC formerly threw before the exact carrier termination.
{
 const f=fixture({reject:action=>action==='stop'}),response=await f.service.stop(request());
 assert.equal(response.status,200);assert.equal((await response.json()).callEnded,true);
 assert.deepEqual(f.effects,['end']);assert(f.row.end_requested_at);assert(f.row.call_ended_at);
}
// Keep incoming maintenance's existing durable-completion contract: stop audio
// and return its fallback instruction if either canonical ending or save fails.
for(const options of [{reject:()=>true},{reject:a=>a==='call_ended'},{failEnd:true},{badCanonical:true}]){
 const f=fixture(options),response=await f.service.stop(request());
 assert.equal(response.status,503);const body=await response.json();
 assert.equal(body.callEnded,false);assert.equal(body.stopped,true);
 assert.deepEqual(f.effects,['end','stop']);assert.equal(f.row.call_ended_at,null);
}
{
 const f=fixture({reject:()=>true}),response=await f.service.stop(request('e'.repeat(64)));
 assert.equal(response.status,401);assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
}
console.log('PASS incoming exact-call termination survives stop-intent failure and preserves canonical/durable completion requirements; offline fixtures only.');
