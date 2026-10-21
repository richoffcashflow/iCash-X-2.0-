// Local receipts only. No network, paid calls, simulations, or production changes.
import assert from 'node:assert/strict';
import {recordedQuotaFailure,findRecordedQuotaFailure} from '../lib/recorded-call-provider-failure.ts';
import {createRecordingProviders} from '../lib/required-call-recording-provider.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
const at=Date.parse('2026-10-21T17:13:00Z'),iso=n=>new Date(at+n).toISOString();
const row={id:'11111111-1111-4111-8111-111111111111',account_id:'22222222-2222-4222-8222-222222222222',operation_key:'voice:33333333-3333-4333-8333-333333333333',party:'seller',created_at:iso(0),agent_id:'agent_fixture',branch_id:'agtbrch_fixture',version_id:'agtvrsn_fixture',provider_account_sid:'AC'+'a'.repeat(32),call_sid:'CA'+'b'.repeat(32),recording_sid:'RE'+'c'.repeat(32),from_phone:'+12125550101',to_phone:'+12125550102',conversation_id:null,state:'available',start_claimed_at:iso(10000),provider_started_at:iso(10000),end_requested_at:iso(15000),call_ended_at:iso(16000),reconcile_lease_token:'44444444-4444-4444-8444-444444444444'};
const c={conversation_id:'conv_fixture',agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id,user_id:row.to_phone,status:'failed',has_user_audio:false,has_response_audio:false,transcript:[],metadata:{termination_reason:"[quota_exceeded] You've run out of credits.",start_time_unix_secs:(at+11000)/1000,call_duration_secs:0,phone_call:{call_sid:row.call_sid,direction:'outbound',agent_number:row.from_phone,external_number:row.to_phone}},conversation_initiation_client_data:{}};
const carrier={sid:row.call_sid,account_sid:row.provider_account_sid,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'completed',date_created:iso(1000)};
const forbidden=async()=>{throw Error('New provider work forbidden');};
const provider={failedConversations:async()=>({has_more:false,conversations:[{conversation_id:c.conversation_id}]}),conversation:async()=>structuredClone(c),getCall:async()=>({...carrier}),dial:forbidden,start:forbidden,register:forbidden,end:forbidden};
assert.equal(recordedQuotaFailure(row,c).reason,'quota_exceeded');
assert.equal(recordedQuotaFailure(row,{...c,metadata:{...c.metadata,termination_reason:null,error:{code:1008,reason:c.metadata.termination_reason}}}).reason,'quota_exceeded','Provider structured error receipt is recognized');
assert.equal((await findRecordedQuotaFailure(provider,row)).conversation_id,c.conversation_id);
for(const mutate of [
 v=>v.agent_id='another_agent',v=>v.branch_id='another_branch',v=>v.version_id='another_version',v=>v.conversation_id='invalid',v=>v.user_id='another_user',
 v=>v.conversation_initiation_client_data.user_id='icash-recorded:another_call',v=>v.conversation_initiation_client_data.branch_id='another_branch',
 v=>v.metadata.phone_call.call_sid='CA'+'d'.repeat(32),v=>v.metadata.phone_call.direction='inbound',v=>v.metadata.phone_call.agent_number='+12125550998',v=>v.metadata.phone_call.external_number='+12125550999',
 v=>v.status='in-progress',v=>v.status='done',v=>v.transcript=[{role:'user',message:'Hello'}],v=>delete v.transcript,v=>v.metadata.call_duration_secs=1,v=>v.metadata.call_duration_secs='0',
 v=>v.has_user_audio=true,v=>v.has_response_audio=true,v=>delete v.has_user_audio,v=>v.metadata.termination_reason='Unknown error',v=>v.metadata.start_time_unix_secs=(at-6000)/1000,v=>v.metadata.start_time_unix_secs=(at+1201000)/1000,v=>v.metadata.start_time_unix_secs='1792602791',
]){const value=structuredClone(c);mutate(value);assert.equal(recordedQuotaFailure(row,value),null,'Mismatched or uncertain provider identity must stay pending');}
for(const partial of [{has_more:true,conversations:[{conversation_id:c.conversation_id}]},{has_more:false,conversations:[]},{has_more:false,conversations:[{conversation_id:c.conversation_id},{conversation_id:'conv_other'}]}])assert.equal(await findRecordedQuotaFailure({...provider,failedConversations:async()=>partial},row),null);
for(const over of [{call_ended_at:null},{conversation_id:'conv_other'},{recording_sid:null},{state:'recording'}])assert.equal(await findRecordedQuotaFailure(provider,{...row,...over}),null);
for(const over of [{sid:'CA'+'d'.repeat(32)},{account_sid:'AC'+'d'.repeat(32)},{from:'+12125550999'},{to:'+12125550998'},{direction:'inbound'},{status:'in-progress'},{date_created:iso(-6000)},{date_created:iso(121000)}])assert.equal(await findRecordedQuotaFailure({...provider,getCall:async()=>({...carrier,...over})},row),null);

// The fallback request is a bounded read against the fixed provider origin.
const env={TWILIO_ACCOUNT_SID:row.provider_account_sid,TWILIO_AUTH_TOKEN:'fixture-token-long-enough',ELEVENLABS_API_KEY:'fixture-key'};
const wire=createRecordingProviders(env,async(url,init)=>{const u=new URL(url);assert.equal(u.origin,'https://api.elevenlabs.io');assert.equal(u.pathname,'/v1/convai/conversations');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(u.searchParams.get('user_id'),row.to_phone);assert.equal(u.searchParams.get('agent_id'),row.agent_id);assert.equal(u.searchParams.get('branch_id'),row.branch_id);assert.equal(u.searchParams.get('version_id'),row.version_id);assert.equal(u.searchParams.get('page_size'),'2');assert.equal(Number(u.searchParams.get('call_start_after_unix')),at/1000-5);assert.equal(Number(u.searchParams.get('call_start_before_unix')),at/1000+1200);return Response.json({has_more:false,conversations:[]});});
await wire.failedConversations(row);

// A failed receipt cannot invent seller interest, callbacks, success, or costs.
for(const party of ['seller','buyer']){
 const expected={conversationId:c.conversation_id,agentId:c.agent_id,party};
 const result=liveConversationResult({...c,analysis:{data_collection_results:{interested:{value:true},opted_out:{value:true},callback_requested:{value:true}}}},expected);
 assert.equal(result.providerFailure,'quota_exceeded');assert.equal(result.durationSeconds,0);assert.equal(result.providerCostUsd,null);assert.equal(result.interested,false);assert.equal(result.optedOut,false);assert.equal(result.callbackDueAt,null);assert.deepEqual(result.transcript,[]);
 assert.equal(liveConversationResult({...c,metadata:{...c.metadata,cost_fiat:0}},expected).providerCostUsd,0,'Only a real zero receipt is zero');
 assert.throws(()=>liveConversationResult(c,{...expected,agentId:'another_agent'}),/ID_MISMATCH/);
 assert.equal(liveConversationResult({...c,status:'processing'},expected),null);
}

// Full maintenance path: audio receipt, carrier proof, immutable binding, then terminal result.
const writes=[];let bound=false,savedResult;
const db=async(path,method,input)=>{
 if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?[structuredClone(row)]:[];
 if(path==='rpc/icash_finish_call_recording_work'){writes.push(input.p_outcome);assert.equal(input.p_outcome,'available');return {...row};}
 if(path==='rpc/icash_transition_call_recording'){assert.equal(input.p_action,'bind_conversation');assert.equal(input.p_payload.conversationId,c.conversation_id);assert.equal(input.p_account,row.account_id);assert.equal(input.p_operation,row.operation_key);bound=true;writes.push('bind');return {...row,conversation_id:c.conversation_id};}
 if(path.startsWith('icash_live_conversations?')){assert(bound);assert(path.includes('account_id=eq.'+row.account_id));return [{id:'55555555-5555-4555-8555-555555555555'}];}
 if(path==='rpc/icash_save_live_result'){assert(bound);writes.push('terminal');savedResult=input.p_result;return null;}
 throw Error('Unexpected database mutation '+path);
};
const warnings=[],warn=console.warn;console.warn=(...a)=>warnings.push(a);
try{
 const result=await maintainRecordings(db,{...provider,conversations:async()=>({has_more:false,conversations:[]}),getRecording:async()=>({sid:row.recording_sid,account_sid:row.provider_account_sid,call_sid:row.call_sid,status:'completed',start_time:row.provider_started_at,duration:'1',price:null})},env);
 assert.equal(result.reconciled,1);assert.deepEqual(writes,['available','bind','terminal']);assert.equal(savedResult.providerFailure,'quota_exceeded');assert.equal(savedResult.providerCostUsd,null);
 assert(!JSON.stringify(warnings).includes(row.to_phone));
}finally{console.warn=warn;}
console.log('PASS quota recovery: exact provider/carrier identity, zero-conversation evidence, terminal completion, bounded reads, no redials or invented costs, and seller/buyer failure semantics.');
