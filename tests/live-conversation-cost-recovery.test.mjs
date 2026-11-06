// Original canonical reads only; no production/provider traffic or financial writes.
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {liveConversationResult} from '../lib/deal-conversation.ts';
const account='11111111-1111-4111-8111-111111111111',callId='22222222-2222-4222-8222-222222222222';
const call={conversation_id:'conv_fixture',agent_id:'agent_fixture',party:'seller',state:'complete',operation_key:'voice:33333333-3333-4333-8333-333333333333'};
async function fixture(reason,change=()=>{}){
 const s={reason,observations:[],provider:{conversation_id:call.conversation_id,agent_id:call.agent_id,status:'done',metadata:{call_duration_secs:12,cost_fiat:0.123456}},reads:0,lookups:0,settles:0,writes:[]};change(s);
 const service=await loadService('lib/live-conversation-service.ts',{
  database:async(path,method,p)=>{
   if(path.startsWith('icash_live_conversations?')){assert(path.includes('account_id=eq.'+account));return [structuredClone(call)];}
   if(path.startsWith('icash_cost_observations?')){s.lookups++;assert(path.includes('event_key=eq.'+call.conversation_id));assert(path.includes('source_ref=eq.'+encodeURIComponent(call.operation_key)));return s.observations;}
   assert.equal(path,'rpc/icash_record_cost_observation','Policy hold must not rewrite result or settle');assert.equal(method,'POST');
   assert.equal(p.p_event,call.conversation_id);assert.equal(p.p_source,call.operation_key);s.writes.push(p);
   if(p.p_provider==='elevenlabs')s.observations=[{amount:p.p_amount,units:p.p_units}];return true;
  },
  elevenRequest:async(path,body)=>{s.reads++;assert.equal(path,'/v1/convai/conversations/'+call.conversation_id);assert.equal(body,undefined,'Recovery must be a GET');if(s.providerError)throw Error('Provider unavailable');return structuredClone(s.provider);},
  liveConversationResult,readVoiceUsagePolicies:()=>[],
  settleBoundVoiceUsage:async()=>{s.settles++;return s.settleWithReceipt&&s.observations.length?{status:'settled'}:{status:'held',reason:s.reason};},
  prepareCompletedSellerDraft:async()=>({status:'unchanged'}),
 });
 s.run=()=>service.reconcileLiveConversation(account,callId);return s;
}
for(const reason of ['reviewed_policy_missing','reviewed_policy_invalid']){
 const s=await fixture(reason);
 assert.deepEqual(await s.run(),{status:'conversation_saved',billing:{status:'held',reason}});
 assert.equal(s.reads,1);assert.equal(s.lookups,1);assert.equal(s.settles,1,'Evidence refresh cannot trigger settlement');
 assert.deepEqual(s.writes.map(p=>[p.p_provider,p.p_amount,p.p_units]),[['elevenlabs_duration',12,'seconds'],['elevenlabs',0.123456,'USD']]);
 await s.run();assert.equal(s.reads,1,'A saved original receipt prevents repeated provider GETs');assert.equal(s.writes.length,2);
}
for(const reason of ['cost_evidence_incomplete','recording_cost_policy_required','ledger_review_required','operation_unbound']){
 const s=await fixture(reason);assert.equal((await s.run()).billing.reason,reason);assert.equal(s.reads,0);assert.equal(s.lookups,0);assert.equal(s.writes.length,0);
}
for(const mutate of [s=>{s.provider.agent_id='foreign';},s=>{s.provider.conversation_id='conv_foreign';}]){
 const s=await fixture('reviewed_policy_missing',mutate);await assert.rejects(s.run(),/VOICE_ID_MISMATCH/);assert.equal(s.writes.length,0);
}
for(const mutate of [s=>{s.provider.status='processing';},s=>{s.provider.status='failed';},s=>{s.provider.status='in-progress';}]){
 const s=await fixture('reviewed_policy_missing',mutate);assert.equal((await s.run()).billing.reason,s.reason);assert.equal(s.writes.length,0);
}
for(const value of [undefined,null,'0.12',-1,Infinity]){
 const s=await fixture('reviewed_policy_missing',s=>{s.provider.metadata.cost_fiat=value;});await s.run();assert.equal(s.writes.filter(p=>p.p_provider==='elevenlabs').length,0,'Missing/invalid USD never becomes zero');
}
const zero=await fixture('reviewed_policy_missing',s=>{s.provider.metadata.cost_fiat=0;});await zero.run();assert.equal(zero.writes.find(p=>p.p_provider==='elevenlabs').p_amount,0,'Explicit original USD zero remains evidence');
const failed=await fixture('reviewed_policy_invalid',s=>{s.provider={...s.provider,status:'failed',has_user_audio:false,has_response_audio:false,transcript:[],metadata:{call_duration_secs:0,cost_fiat:null,error:{reason:'[quota_exceeded] Fixture'}}};});
await failed.run();assert.deepEqual(failed.writes.map(p=>[p.p_provider,p.p_amount]),[['elevenlabs_duration',0]],'Quota rejection is not a zero USD receipt');
const unavailable=await fixture('reviewed_policy_missing',s=>{s.providerError=true;});await assert.rejects(unavailable.run(),/Provider unavailable/);assert.equal(unavailable.writes.length,0);
for(const reason of ['provider_receipt_missing','duration_missing']){
 const s=await fixture(reason,s=>{s.settleWithReceipt=true;});
 assert.equal((await s.run()).billing.status,'settled','Completed calls can use exact terminal billing metadata without optional analysis');
 assert.equal(s.reads,1);assert.equal(s.settles,2);
 assert.deepEqual(s.writes.map(p=>[p.p_provider,p.p_amount]),[['elevenlabs_duration',12],['elevenlabs',0.123456]]);
 const missing=await fixture(reason,s=>{delete s.provider.metadata.cost_fiat;});
 assert.equal((await missing.run()).billing.status,'held');assert(!missing.writes.some(p=>p.p_provider==='elevenlabs'));
 const wrong=await fixture(reason,s=>{s.provider.agent_id='other';});
 await assert.rejects(wrong.run(),/VOICE_ID_MISMATCH/);assert.equal(wrong.writes.length,0);
 const processing=await fixture(reason,s=>{s.provider.status='processing';});
 assert.equal((await processing.run()).status,'awaiting_conversation');assert.equal(processing.writes.length,0);
}
console.log('PASS late original USD capture behind historical policy holds: exact identity/source, terminal metadata, one GET, saved-evidence skip, unchanged holds and no settlement/transcript/provider writes.');
