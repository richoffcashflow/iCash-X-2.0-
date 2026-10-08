import {sellerOfferReceptionPolicy,sellerOfferReceptionPolicyHash,sellerOfferReceptionPrompt} from '../lib/seller-offer-reception.ts';
import assert from 'node:assert/strict';
import {prepareSellerOfferReception} from '../scripts/prepare-seller-offer-reception.mjs';
import {receptionTarget} from '../lib/general-reception.ts';
import {inspectRecordedReceptionAgent,recordedReceptionStopInstruction,recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {buyerReceptionPrompt,buyerReceptionPolicyHash} from '../lib/buyer-reception-context.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
const c={id:'11111111-1111-4111-8111-111111111111',account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,agent_id:receptionTarget.agentId,call_profile:'normal',entry_policy:'direct_recorded_v1',branch_id:'agtbrch_old',reviewed_version_id:'agtvrsn_old',context_policy:'buyer_seller_v1',context_policy_hash:buyerReceptionPolicyHash,context_approval_reference:'Synthetic reviewed property script',stop_tool_id:'tool_stop',max_duration_seconds:600,config_hash:''};
const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_reception_recording',api_schema:{url:recordedReceptionUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}};
const agent={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,main_branch_id:'agtbrch_main',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{first_message:'{{icash_property_greeting}}',prompt:{prompt:buyerReceptionPrompt+directRecordedInstructions,max_tokens:120,tool_ids:['tool_stop'],tools:[],knowledge_base:[]}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{agent_concurrency_limit:1,bursting_enabled:false},queueing_config:{enabled:false},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true}}},workspace_overrides:{webhooks:{post_call_webhook_id:null,events:[],send_audio:false}}}};
const old={id:c.branch_id,agent_id:c.agent_id,current_live_percentage:0,is_archived:false,draft_exists:false};c.config_hash=inspectRecordedReceptionAgent(c,agent,old,true,tool).hash;
const env={VERCEL_ENV:'production',ICASH_DIRECT_CALLS_PREPARE:'true',SUPABASE_URL:'https://db.invalid',SUPABASE_SECRET_KEY:'synthetic-private',ELEVENLABS_API_KEY:'synthetic-key'};
for(const denied of [false,true]){
 let created=false;const writes=[];
 const fetcher=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;let value;
  if(init.method==='POST')writes.push({path:u.pathname,body});
  if(u.pathname.endsWith('icash_get_recorded_reception_config'))value=c;
  else if(u.pathname.endsWith('icash_claim_seller_offer_branch'))value=!denied;
  else if(u.pathname.endsWith('icash_stage_seller_offer_reception'))value={enabled:false,id:'candidate',context_policy:sellerOfferReceptionPolicy,context_policy_hash:sellerOfferReceptionPolicyHash,entry_policy:'direct_recorded_v1',branch_id:body.p_branch,reviewed_version_id:body.p_version,config_hash:body.p_hash};
  else if(u.pathname.endsWith('/settings'))value={webhooks:{post_call_webhook_id:null}};
  else if(u.pathname.endsWith('/tools/tool_stop'))value=tool;
  else if(u.pathname.endsWith('/branches')&&init.method==='POST'){
   assert.equal(body.parent_version_id,c.reviewed_version_id);assert.equal(body.conversation_config.agent.prompt.prompt,sellerOfferReceptionPrompt+directRecordedInstructions);
   assert.equal(body.platform_settings,undefined);created=true;value={created_branch_id:'agtbrch_direct'};
  }else if(u.pathname.endsWith('/branches'))value={results:[old,...(created?[{...old,id:'agtbrch_direct',name:'qualified-seller-cash-offer-20261008'}]:[])]};
  else if(u.searchParams.get('branch_id')==='agtbrch_direct'){value=structuredClone(agent);value.branch_id='agtbrch_direct';value.version_id='agtvrsn_direct';value.conversation_config.agent.prompt.prompt=sellerOfferReceptionPrompt+directRecordedInstructions;}
  else value=agent;
  return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 };
 if(denied){await assert.rejects(prepareSellerOfferReception(env,fetcher),/PRIOR_BRANCH_CREATE_UNCONFIRMED/);assert(!created);}else{const result=await prepareSellerOfferReception(env,fetcher);assert.equal(result.status,'staged');assert(created);}
 assert(!writes.some(w=>w.path.includes('/Calls')||w.path.includes('enable')));
}
assert.equal((await prepareSellerOfferReception({...env,VERCEL_ENV:'preview'},()=>{throw Error('MUST_NOT_RUN');})).status,'not_requested');
for(const policy of ['automatic_offer_v8','automatic_offer_v9']){
 let reads=0;
 const result=await prepareSellerOfferReception(env,async(url)=>{
  assert(new URL(url).pathname.endsWith('icash_get_recorded_reception_config'));
  reads++;
  return new Response(JSON.stringify({...c,context_policy:policy}));
 });
 assert.equal(result.status,'already_active');assert.equal(reads,1);
}
console.log('Direct reception staging: isolated verified branch, durable single create claim, no activation/routing/spend, preview inert.');
