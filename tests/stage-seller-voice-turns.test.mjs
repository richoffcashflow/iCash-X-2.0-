import assert from 'node:assert/strict';
import {stageSellerVoiceTurns,publicSellerTurnStage} from '../scripts/stage-seller-voice-turns.mjs';
import {canonical,sha} from '../lib/required-call-recording.ts';
import {recordedOutboundTarget as outTarget} from '../lib/recorded-outbound-readiness.ts';
import {receptionTarget} from '../lib/general-reception.ts';
import {recordedReceptionUrl,inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {automaticOfferToolConfig} from '../lib/seller-agreement-tool.ts';
import {automaticOfferGuardrails} from '../lib/automatic-offer-policy.ts';
import {buyerVoiceGuardrail} from '../lib/buyer-voice-policy.ts';
import {buyerRolePrompt} from '../lib/buyer-role-policy.ts';
import {isolatedBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {sellerVoiceTurnConfig} from '../lib/seller-voice-turn-policy.ts';
const now=Date.parse('2026-11-14T22:00:00Z'),commit='b'.repeat(40),sid='AC'+'a'.repeat(32);
const snap=a=>({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null});
const hash=a=>sha(JSON.stringify(canonical(snap(a))));
const branch=a=>({id:a.branch_id,agent_id:a.agent_id,name:a.name??'source',is_archived:false,draft_exists:false,current_live_percentage:0});
function fixture(options={}){
 const turn={turn_eagerness:'eager',turn_timeout:7,turn_model:'turn_v3',spelling_patience:'auto',speculative_turn:false,soft_timeout_config:{timeout_seconds:2,message:'One moment.',disable_until_first_user_message:true}};
 const platform={auth:{enable_auth:true},privacy:{record_voice:false},call_limits:{agent_concurrency_limit:1,bursting_enabled:false},queueing_config:{enabled:false},workspace_overrides:{webhooks:{send_audio:false,events:[],post_call_webhook_id:null}},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}};
 const tool=(id,role,keys,variable)=>({id,tool_config:{type:'webhook',name:role==='recording/stop'?'icash_stop_recording':'fixture',api_schema:{url:'https://www.geticashx.com/api/internal/voice/'+role,method:'POST',request_headers:{Authorization:{variable_name:variable}},request_body_schema:{type:'object',required:keys,properties:Object.fromEntries(keys.map(k=>[k,{type:'string',...(k==='recordingId'?{dynamic_variable:'icash_recording_id'}:k==='conversationId'?{dynamic_variable:'system__conversation_id'}:{})}]))}}}});
 const contractId='tool_fixtureagreement',inStopId='tool_fixtureinstop';
 const tools=new Map([
  [outTarget.stopToolId,tool(outTarget.stopToolId,'recording/stop',['recordingId'],'secret__icash_recording_stop_token')],
  [outTarget.callbackToolId,tool(outTarget.callbackToolId,'callback',['conversationId','dueAt','timezone','readback','confirmation'],'secret__icash_call_token')],
  [outTarget.handoffToolId,tool(outTarget.handoffToolId,'handoff',['conversationId','reason'],'secret__icash_call_token')],
  [contractId,{id:contractId,tool_config:structuredClone(automaticOfferToolConfig)}],
  [inStopId,{id:inStopId,tool_config:{type:'webhook',name:'icash_stop_reception_recording',api_schema:{url:recordedReceptionUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}}],
 ]);
 const outbound={agent_id:outTarget.agentId,branch_id:'agtbrch_outsource',version_id:'agtvrsn_outsource',main_branch_id:'agtbrch_outmain',phone_numbers:[],conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},turn:structuredClone(turn),agent:{first_message:'fixture',prompt:{prompt:'PRIVATE_OUTBOUND_PROMPT',max_tokens:150,tool_ids:[outTarget.callbackToolId,outTarget.handoffToolId,outTarget.stopToolId,contractId]}}},platform_settings:{...structuredClone(platform),guardrails:automaticOfferGuardrails()}};
 const c={id:'11111111-1111-4111-8111-111111111111',enabled:true,callback_template_id:null,account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,agent_id:receptionTarget.agentId,call_profile:'normal',entry_policy:'direct_recorded_v1',branch_id:'agtbrch_insource',version_id:'agtvrsn_insource',reviewed_version_id:'agtvrsn_insource',context_policy:'automatic_offer_v11',context_policy_hash:isolatedBuyerReceptionPolicyHash,context_approval_reference:'Synthetic reviewed source only',stop_tool_id:inStopId,agreement_tool_id:contractId,max_duration_seconds:600,config_hash:'',reviewed_until:'9999-12-31T23:59:59Z'};
 const incoming={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,main_branch_id:'agtbrch_inmain',phone_numbers:[],conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},turn:structuredClone(turn),agent:{first_message:'{{icash_property_greeting}}',prompt:{prompt:buyerRolePrompt+directRecordedInstructions,max_tokens:150,tool_ids:[inStopId,contractId],tools:[],knowledge_base:[]}}},platform_settings:structuredClone(platform)};
 incoming.platform_settings.guardrails=automaticOfferGuardrails();incoming.platform_settings.guardrails.custom.config.configs=[buyerVoiceGuardrail];
 c.config_hash=inspectRecordedReceptionAgent(c,incoming,branch(incoming),true,tools.get(inStopId),tools.get(contractId)).hash;
 assert(inspectRecordedReceptionAgent(c,incoming,branch(incoming),true,tools.get(inStopId),tools.get(contractId)).safe,'Synthetic incoming source must exercise real validator');
 const review={enabled:true,offerPolicy:'automatic_offer_v9',agentId:outbound.agent_id,branchId:outbound.branch_id,versionId:outbound.version_id,configHash:hash(outbound),fromPhone:'+12125550100',providerAccountSid:sid,stopToolId:outTarget.stopToolId,contractToolId:contractId,toolIds:outbound.conversation_config.agent.prompt.tool_ids,approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:'required-audio-30d-speech-v1',reviewedAt:new Date(now-10000).toISOString(),reviewedUntil:'9999-12-31T23:59:59Z'};
 const source={outbound:{agentId:review.agentId,branchId:review.branchId,versionId:review.versionId,configHash:review.configHash,contextPolicy:review.offerPolicy},inbound:{configId:c.id,agentId:c.agent_id,branchId:c.branch_id,versionId:c.reviewed_version_id,configHash:c.config_hash,contextPolicy:c.context_policy}};
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:commit,VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_PROVIDER:'github',ICASH_SELLER_TURN_STAGE_COMMIT:commit,ICASH_SELLER_TURN_SOURCE_JSON:JSON.stringify(source),RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:sid,SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'SYNTHETIC_DB_SECRET',ELEVENLABS_API_KEY:'SYNTHETIC_PROVIDER_SECRET'};
 const agents=new Map([[outbound.branch_id,outbound],[incoming.branch_id,incoming]]),markers=new Map(),calls=[];
 let creationCount=0,claimCount=0;
 const response=data=>Response.json(structuredClone(data));
 async function fetcher(url,init){
  const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;calls.push({url,method,body});
  assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  if(u.hostname==='ofjbbpwugyjfxbhqfguh.supabase.co'){
   if(u.pathname.endsWith('/rpc/icash_get_recorded_reception_config'))return response(c);
   assert(u.pathname.endsWith('/icash_integration_checks'),'No active database config writes');
   const marker=u.searchParams.get('provider')?.slice(3);
   if(method==='GET')return response(markers.has(marker)?[markers.get(marker)]:[]);
   if(method==='POST'){
    claimCount++;if(markers.has(body.provider))return new Response('conflict',{status:409});markers.set(body.provider,structuredClone(body));
    if(options.claimLost&&claimCount===1)throw Error('lost claim response');
    return response([body]);
   }
   assert.equal(method,'PATCH');const prior=markers.get(marker);assert.equal(u.searchParams.get('result->>nonce'),'eq.'+prior.result.nonce);
   markers.set(marker,{...prior,...structuredClone(body)});return response([markers.get(marker)]);
  }
  assert.equal(u.hostname,'api.elevenlabs.io');
  if(u.pathname==='/v1/convai/settings')return response({webhooks:{post_call_webhook_id:null}});
  if(u.pathname.startsWith('/v1/convai/tools/'))return response(tools.get(u.pathname.split('/').at(-1)));
  const id=u.pathname.split('/')[4];
  if(u.pathname.endsWith('/branches')){
   if(method==='GET')return response({results:[...agents.values()].filter(a=>a.agent_id===id).map(branch),meta:{total:[...agents.values()].filter(a=>a.agent_id===id).length}});
   assert.equal(method,'POST');creationCount++;
   assert.equal(body.include_draft,false);const parent=[...agents.values()].find(a=>a.agent_id===id&&a.version_id===body.parent_version_id);assert(parent);
   assert.deepEqual(body.conversation_config,{turn:sellerVoiceTurnConfig(parent.conversation_config.turn)});
   const candidate=structuredClone(parent);candidate.branch_id='agtbrch_candidate'+creationCount;candidate.version_id='agtvrsn_candidate'+creationCount;candidate.name=body.name;
   candidate.conversation_config.turn={...candidate.conversation_config.turn,...body.conversation_config.turn,soft_timeout_config:{...candidate.conversation_config.turn.soft_timeout_config,...body.conversation_config.turn.soft_timeout_config}};
   if(options.candidateDrift)candidate.conversation_config.agent.prompt.prompt+=' drift';
   if(options.missingPhones&&id===incoming.agent_id)delete candidate.phone_numbers;
   if(options.malformedPhones&&id===incoming.agent_id)candidate.phone_numbers={};
   if(options.sourceDrift)parent.conversation_config.agent.prompt.prompt+=' changed';
   if(!options.createLostWithoutBranch)agents.set(candidate.branch_id,candidate);
   if(options.createLost||options.createLostWithoutBranch)throw Error('lost provider response');
   return response({created_branch_id:candidate.branch_id});
  }
  assert.equal(method,'GET','Never patch, delete or deploy a provider branch');
  return response(agents.get(u.searchParams.get('branch_id')));
 }
 return {env,source,review,c,incoming,outbound,tools,agents,markers,calls,fetcher,get creationCount(){return creationCount;}};
}

assert.deepEqual(await stageSellerVoiceTurns({},()=>{throw Error('no reads');},now),{status:'not_requested'});
{
 const f=fixture(),saved=structuredClone({incoming:f.incoming,outbound:f.outbound,c:f.c,review:f.review});
 const result=await stageSellerVoiceTurns(f.env,f.fetcher,now);
 assert.equal(result.status,'staged');assert.equal(result.providerWrites,2);assert.equal(f.creationCount,2);
 assert.deepEqual({incoming:f.incoming,outbound:f.outbound,c:f.c,review:f.review},saved,'Source branches, rates and active approvals remain unchanged');
 assert.equal(result.outbound.review.reviewedUntil,'9999-12-31T23:59:59Z');
 assert.equal([...f.markers.values()].filter(x=>x.result.state==='verified').length,1);
 const again=await stageSellerVoiceTurns(f.env,f.fetcher,now+5000);
 assert.equal(again.providerWrites,0);assert.equal(f.creationCount,2);assert.deepEqual(again.outbound,result.outbound);assert.deepEqual(again.inbound,result.inbound);
 const printed=JSON.stringify(publicSellerTurnStage(result));
 for(const secret of ['SYNTHETIC_DB_SECRET','SYNTHETIC_PROVIDER_SECRET',sid,'PRIVATE_OUTBOUND_PROMPT','fromPhone','reviewedUntil',receptionTarget.calledNumber])assert(!printed.includes(secret));
 assert(f.calls.filter(x=>x.url.startsWith('https://api.elevenlabs.io')&&x.method!=='GET').every(x=>x.url.endsWith('/branches')&&x.method==='POST'));
}
for(const options of [{createLost:true},{createLostWithoutBranch:true},{claimLost:true}]){
 const f=fixture(options);
 if(options.createLost){const result=await stageSellerVoiceTurns(f.env,f.fetcher,now);assert.equal(result.status,'staged');assert.equal(f.creationCount,2);}
 else{
  await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_/);
  const creates=f.creationCount;
  await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now+1000),/CREATE_UNCONFIRMED_NO_RETRY/);
  assert.equal(f.creationCount,creates,'An unknown branch creation or claim never issues another POST');
 }
}
for(const options of [{candidateDrift:true},{sourceDrift:true}]){
 const f=fixture(options);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_(CANDIDATE_CONFIG_CHANGED|SOURCE_MUTATED)/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'));assert.equal(f.creationCount,1);
}
for(const options of [{missingPhones:true},{malformedPhones:true}]){
 const f=fixture(options);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_CANDIDATE_IDENTITY_CHANGED/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'));
}
for(const mutate of [f=>f.env.VERCEL_ENV='preview',f=>f.env.ICASH_SELLER_TURN_SOURCE_JSON='{}',f=>f.env.SUPABASE_URL='https://other.supabase.co',f=>f.c.config_hash='a'.repeat(64),f=>f.outbound.conversation_config.agent.prompt.prompt+=' drift',f=>f.tools.get(f.c.stop_tool_id).tool_config.api_schema.url='https://untrusted.invalid']){
 const f=fixture();mutate(f);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),undefined,String(mutate));assert.equal(f.creationCount,0);assert.equal(f.markers.size,0);
}
console.log('PASS exact-commit seller turn staging: actual inbound/outbound validators, two isolated branches, unchanged sources/tools/authority, idempotent candidate revalidation, unknown-write GET-only recovery, drift rejection, no activation or paid calls, sanitized output.');
