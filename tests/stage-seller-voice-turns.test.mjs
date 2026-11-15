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
 for(const tool of tools.values()){
  tool.access_info={is_creator:true,role:'admin'};tool.response_mocks=[];
  if(!options.omitUsageStats)tool.usage_stats={avg_latency_secs:1.25,total_calls:10};
 }
 const outbound={agent_id:outTarget.agentId,branch_id:'agtbrch_outsource',version_id:'agtvrsn_outsource',main_branch_id:'agtbrch_outmain',phone_numbers:[],conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},turn:structuredClone(turn),agent:{first_message:'fixture',prompt:{prompt:'PRIVATE_OUTBOUND_PROMPT',max_tokens:150,tool_ids:[outTarget.callbackToolId,outTarget.handoffToolId,outTarget.stopToolId,contractId]}}},platform_settings:{...structuredClone(platform),guardrails:automaticOfferGuardrails()}};
 const c={id:'11111111-1111-4111-8111-111111111111',enabled:true,callback_template_id:null,account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,agent_id:receptionTarget.agentId,call_profile:'normal',entry_policy:'direct_recorded_v1',branch_id:'agtbrch_insource',version_id:'agtvrsn_insource',reviewed_version_id:'agtvrsn_insource',context_policy:'automatic_offer_v11',context_policy_hash:isolatedBuyerReceptionPolicyHash,context_approval_reference:'Synthetic reviewed source only',stop_tool_id:inStopId,agreement_tool_id:contractId,max_duration_seconds:600,config_hash:'',reviewed_until:'9999-12-31T23:59:59Z'};
 const incoming={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,main_branch_id:'agtbrch_inmain',phone_numbers:[],conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},turn:structuredClone(turn),agent:{first_message:'{{icash_property_greeting}}',prompt:{prompt:buyerRolePrompt+directRecordedInstructions,max_tokens:150,tool_ids:[inStopId,contractId],tools:[],knowledge_base:[]}}},platform_settings:structuredClone(platform)};
 incoming.platform_settings.guardrails=automaticOfferGuardrails();incoming.platform_settings.guardrails.custom.config.configs=[buyerVoiceGuardrail];
 if(options.inheritedPhones)incoming.phone_numbers=[{phone_number_id:'phnum_existing',branch_id:incoming.main_branch_id}];
 if(options.versionedWorkflow)incoming.workflow={edges:{},nodes:{start_node:{type:'start',position:{x:0,y:0},edge_order:[],parent_subgraph_id:null}},subgraphs:{},prevent_subagent_loops:true};
 c.config_hash=inspectRecordedReceptionAgent(c,incoming,branch(incoming),true,tools.get(inStopId),tools.get(contractId)).hash;
 if(options.versionedWorkflow){incoming.workflow.version=1;incoming.workflow.frames={};incoming.workflow.nodes.start_node.parent_frame_id=null;incoming.conversation_config.agent.prompt.enable_prompt_caching=true;}
 assert(inspectRecordedReceptionAgent(c,incoming,branch(incoming),true,tools.get(inStopId),tools.get(contractId)).safe,'Synthetic incoming source must exercise real validator');
 const review={enabled:true,offerPolicy:'automatic_offer_v9',agentId:outbound.agent_id,branchId:outbound.branch_id,versionId:outbound.version_id,configHash:hash(outbound),fromPhone:'+12125550100',providerAccountSid:sid,stopToolId:outTarget.stopToolId,contractToolId:contractId,toolIds:outbound.conversation_config.agent.prompt.tool_ids,approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:'required-audio-30d-speech-v1',reviewedAt:new Date(now-10000).toISOString(),reviewedUntil:'9999-12-31T23:59:59Z'};
 const source={outbound:{agentId:review.agentId,branchId:review.branchId,versionId:review.versionId,configHash:review.configHash,contextPolicy:review.offerPolicy},inbound:{configId:c.id,agentId:c.agent_id,branchId:c.branch_id,versionId:c.reviewed_version_id,configHash:c.config_hash,contextPolicy:c.context_policy}};
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:commit,VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_PROVIDER:'github',ICASH_SELLER_TURN_STAGE_COMMIT:commit,ICASH_SELLER_TURN_SOURCE_JSON:JSON.stringify(source),RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:sid,SUPABASE_URL:'https://ofjbbpwugyjfxbhqfguh.supabase.co',SUPABASE_SECRET_KEY:'SYNTHETIC_DB_SECRET',ELEVENLABS_API_KEY:'SYNTHETIC_PROVIDER_SECRET'};
 const agents=new Map([[outbound.branch_id,outbound],[incoming.branch_id,incoming]]),markers=new Map(),calls=[],routingReads=new Map(),toolReads=new Map();
 let creationCount=0,claimCount=0,configReads=0;
 const response=data=>Response.json(structuredClone(data));
 async function handle(url,init){
  const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;calls.push({url,method,body});
  assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  if(u.hostname==='ofjbbpwugyjfxbhqfguh.supabase.co'){
   if(u.pathname.endsWith('/rpc/icash_get_recorded_reception_config')){configReads++;const current=structuredClone(c);if(configReads%2===0)options.mutateFinalConfig?.(current);return response(current);}
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
  if(u.pathname==='/v1/convai/v2/phone-numbers'){
   assert.equal(method,'GET');assert.equal(u.searchParams.get('page_size'),'1000');
   const branchId=u.searchParams.get('branch_id'),agentId=u.searchParams.get('agent_id');
   assert.equal(agents.get(branchId)?.agent_id,agentId,'Routing proof must filter the exact candidate agent and branch');
   assert(branchId.startsWith('agtbrch_candidate'));
   const read=(routingReads.get(branchId)??0)+1;routingReads.set(branchId,read);
   return response(options.routeResponse?options.routeResponse({agentId,branchId,read}):{phone_numbers:[],has_more:false,next_cursor:null});
  }
  if(u.pathname==='/v1/convai/settings'){const workspace={webhooks:{post_call_webhook_id:null}};if(configReads%2===0)options.mutateFinalWorkspace?.(workspace);return response(workspace);}
  if(u.pathname.startsWith('/v1/convai/tools/')){
   const toolId=u.pathname.split('/').at(-1),tool=structuredClone(tools.get(toolId)),read=(toolReads.get(toolId)??0)+1;toolReads.set(toolId,read);
   options.mutateToolRead?.(tool,{toolId,read,final:configReads%2===0});return response(tool);
  }
  const id=u.pathname.split('/')[4];
  if(u.pathname.endsWith('/branches')){
   if(method==='GET')return response({results:[...agents.values()].filter(a=>a.agent_id===id).map(a=>{const b=branch(a);if(a.branch_id.startsWith('agtbrch_candidate'))options.mutateCandidateBranch?.(b);return b;}),meta:{total:[...agents.values()].filter(a=>a.agent_id===id).length}});
   assert.equal(method,'POST');creationCount++;
   assert.equal(body.include_draft,false);const parent=[...agents.values()].find(a=>a.agent_id===id&&a.version_id===body.parent_version_id);assert(parent);
   assert.deepEqual(body.conversation_config,{turn:sellerVoiceTurnConfig(parent.conversation_config.turn)});
   const candidate=structuredClone(parent);candidate.branch_id='agtbrch_candidate'+creationCount;candidate.version_id='agtvrsn_candidate'+creationCount;candidate.name=body.name;
   candidate.conversation_config.turn={...candidate.conversation_config.turn,...body.conversation_config.turn,soft_timeout_config:{...candidate.conversation_config.turn.soft_timeout_config,...body.conversation_config.turn.soft_timeout_config}};
   if(options.candidateDrift)candidate.conversation_config.agent.prompt.prompt+=' drift';
   if(options.missingPhones&&id===incoming.agent_id)delete candidate.phone_numbers;
   if(options.malformedPhones&&id===incoming.agent_id)candidate.phone_numbers={};
   options.mutateCandidate?.(candidate,parent);
   if(options.sourceDrift)parent.conversation_config.agent.prompt.prompt+=' changed';
   if(!options.createLostWithoutBranch)agents.set(candidate.branch_id,candidate);
   if(options.createLost||options.createLostWithoutBranch)throw Error('lost provider response');
   return response({created_branch_id:candidate.branch_id});
  }
  assert.equal(method,'GET','Never patch, delete or deploy a provider branch');
  const agent=structuredClone(agents.get(u.searchParams.get('branch_id')));
  if(agent?.branch_id.startsWith('agtbrch_candidate'))options.mutateCandidateRead?.(agent);
  else if(configReads%2===0)options.mutateFinalSource?.(agent);
  return response(agent);
 }
 async function fetcher(url,init){
  const result=await handle(url,init);
  // Native fetch reports the canonical response URL, including percent-encoded
  // PostgREST JSON operators. Response.json() alone leaves this field empty.
  Object.defineProperty(result,'url',{value:new URL(url).href,configurable:true});
  return result;
 }
 return {options,env,source,review,c,incoming,outbound,tools,agents,markers,calls,routingReads,fetcher,get creationCount(){return creationCount;}};
}

assert.deepEqual(await stageSellerVoiceTurns({},()=>{throw Error('no reads');},now),{status:'not_requested'});
for(const mutate of [
 r=>Object.defineProperty(r,'redirected',{value:true}),
 r=>Object.defineProperty(r,'url',{value:r.url.replace('ofjbbpwugyjfxbhqfguh.supabase.co','different.invalid')}),
 r=>Object.defineProperty(r,'url',{value:r.url.replace('/icash_integration_checks','/different')}),
 r=>Object.defineProperty(r,'url',{value:r.url+'&different=true'}),
]){
 const f=fixture();
 await assert.rejects(stageSellerVoiceTurns(f.env,async(url,init)=>{
  const r=await f.fetcher(url,init);if(init.method==='PATCH')mutate(r);return r;
 },now),/SELLER_TURNS_REQUEST_UNCONFIRMED/);
 assert.equal(f.creationCount,1);assert.equal(f.markers.size,1);
 assert(!f.calls.some(x=>x.method==='GET'&&new URL(x.url).searchParams.get('provider')?.endsWith('_inbound')),'A redirected or different save response cannot proceed to inbound staging');
}
{
 const f=fixture(),saved=structuredClone({incoming:f.incoming,outbound:f.outbound,c:f.c,review:f.review});
 const result=await stageSellerVoiceTurns(f.env,f.fetcher,now);
 assert.equal(result.status,'staged');assert.equal(result.providerWrites,2);assert.equal(f.creationCount,2);
 assert.equal(result.release,commit);assert.equal(result.verifiedByRelease,commit);assert.equal(result.phoneRoutingVerification,'branch-phone-list-v1');
 assert.deepEqual([...f.routingReads.values()],[2,2],'Both candidate routing lists are checked initially and at final verification');
 assert.deepEqual({incoming:f.incoming,outbound:f.outbound,c:f.c,review:f.review},saved,'Source branches, rates and active approvals remain unchanged');
 assert.equal(result.outbound.review.reviewedUntil,'9999-12-31T23:59:59Z');
 assert.equal([...f.markers.values()].filter(x=>x.result.state==='verified').length,1);
 const again=await stageSellerVoiceTurns(f.env,f.fetcher,now+5000);
 assert.equal(again.providerWrites,0);assert.equal(f.creationCount,2);assert.deepEqual(again.outbound,result.outbound);assert.deepEqual(again.inbound,result.inbound);
 const printed=JSON.stringify(publicSellerTurnStage(result));
 for(const secret of ['SYNTHETIC_DB_SECRET','SYNTHETIC_PROVIDER_SECRET',sid,'PRIVATE_OUTBOUND_PROMPT','fromPhone','reviewedUntil',receptionTarget.calledNumber])assert(!printed.includes(secret));
 assert(f.calls.filter(x=>x.url.startsWith('https://api.elevenlabs.io')&&x.method!=='GET').every(x=>x.url.endsWith('/branches')&&x.method==='POST'));
}
{
 const f=fixture({versionedWorkflow:true}),before=structuredClone({incoming:f.incoming,c:f.c});
 const result=await stageSellerVoiceTurns(f.env,f.fetcher,now);
 assert.equal(result.status,'staged');assert.equal(f.creationCount,2);
 assert.deepEqual({incoming:f.incoming,c:f.c},before,'Provider serialization compatibility never changes the source or its saved approval');
 assert.equal(f.agents.get(result.inbound.branchId).workflow.prevent_subagent_loops,true);
}
for(const mutate of [f=>f.incoming.workflow.prevent_subagent_loops=false,f=>f.incoming.workflow.version=2,f=>f.incoming.workflow.nodes.action={type:'tool'},f=>f.incoming.workflow.extra=null]){
 const f=fixture({versionedWorkflow:true});mutate(f);
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_INBOUND_SOURCE_CHANGED/);
 assert.equal(f.creationCount,0);assert.equal(f.markers.size,0,'All source checks precede durable intent or provider writes');
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
for(const options of [{missingPhones:true},{inheritedPhones:true},{routeResponse:()=>({phone_numbers:[],has_more:false})},{routeResponse:()=>({phone_numbers:[]})}]){
 const f=fixture(options),result=await stageSellerVoiceTurns(f.env,f.fetcher,now);
 assert.equal(result.status,'staged');assert.deepEqual([...f.routingReads.values()],[2,2]);
}
for(const value of [null,{},false,'',0]){
 const f=fixture({mutateCandidate:(candidate,parent)=>{if(parent.agent_id===receptionTarget.agentId)candidate.phone_numbers=value;}});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_CANDIDATE_PHONE_METADATA_INVALID/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'));
}
for(const [mutate,code] of [
 [candidate=>{delete candidate.phone_numbers;},'PHONE_METADATA_INVALID'],
 [candidate=>{candidate.phone_numbers=[{phone_number_id:'phnum_other'}];},'OUTBOUND_CANDIDATE_PHONE_METADATA_ACTIVE'],
 [candidate=>{candidate.main_branch_id='agtbrch_other';},'MAIN_BRANCH_CHANGED'],
 [candidate=>{candidate.version_id='unversioned';},'VERSION_REQUIRED'],
 [(candidate,parent)=>{candidate.version_id=parent.version_id;},'VERSION_UNCHANGED'],
]){
 const f=fixture({mutateCandidate:mutate});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),new RegExp('SELLER_TURNS_(?:CANDIDATE_)?'+code));
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'));
}
for(const [options,code] of [
 [{mutateCandidateRead:candidate=>{candidate.agent_id='agent_other';}},'CANDIDATE_AGENT_CHANGED'],
 [{mutateCandidateRead:candidate=>{candidate.branch_id='agtbrch_other';}},'CANDIDATE_BRANCH_CHANGED'],
 [{mutateCandidateBranch:branch=>{branch.agent_id='agent_other';}},'CANDIDATE_BRANCH_AGENT_CHANGED'],
]){
 const f=fixture(options);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),new RegExp('SELLER_TURNS_'+code));
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'));
}
const invalidRouting=[
 null,{},[],{phone_numbers:null,has_more:false},{phone_numbers:{},has_more:false},
 ...[true,null,'false',0,1].map(has_more=>({phone_numbers:[],has_more})),
 ...['',false,0,'cursor',{}].map(next_cursor=>({phone_numbers:[],has_more:false,next_cursor})),
 {phone_numbers:[{phone_number_id:'phnum_assigned'}],has_more:false,next_cursor:null},
];
for(const agentId of [outTarget.agentId,receptionTarget.agentId])for(const read of [1,2])for(const invalid of invalidRouting){
 const f=fixture({routeResponse:query=>query.agentId===agentId&&query.read===read?invalid:{phone_numbers:[],has_more:false,next_cursor:null}});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_(PHONE_LIST_REQUIRED|PHONE_LIST_INCOMPLETE|PHONE_LIST_CURSOR_PRESENT|CANDIDATE_PHONE_ROUTING_ACTIVE)/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'),'Missing, partial or changed routing can never publish a verified receipt');
}

const execution='c'.repeat(40);
function resumeEnv(f){Object.assign(f.env,{VERCEL_GIT_COMMIT_SHA:execution,ICASH_SELLER_TURN_STAGE_COMMIT:execution,ICASH_SELLER_TURN_RESUME_RELEASE:commit});}
function assertResumeHasNoCreates(calls){
 assert(calls.filter(x=>x.url.startsWith('https://api.elevenlabs.io')).every(x=>x.method==='GET'),'Resume never posts to the provider');
 assert(!calls.some(x=>x.method==='POST'&&x.body?.result?.state==='creating'),'Resume never claims a missing direction');
}
async function unfinishedPair(){
 const options={inheritedPhones:true,routeResponse:({agentId})=>({phone_numbers:[],has_more:agentId===receptionTarget.agentId,next_cursor:null})};
 const f=fixture(options);
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_PHONE_LIST_INCOMPLETE/);
 assert.equal(f.creationCount,2);assert.deepEqual([...f.markers.values()].map(x=>x.result.state),['candidate','creating']);
 delete options.routeResponse;resumeEnv(f);return f;
}
{
 const f=await unfinishedPair(),before=f.calls.length,saved=structuredClone({incoming:f.incoming,outbound:f.outbound,review:f.review,c:f.c});
 const result=await stageSellerVoiceTurns(f.env,f.fetcher,now+1000);
 assert.equal(result.providerWrites,0);assert.equal(f.creationCount,2);assertResumeHasNoCreates(f.calls.slice(before));
 assert.equal(result.release,commit);assert.equal(result.verifiedByRelease,execution);assert.equal(result.phoneRoutingVerification,'branch-phone-list-v1');
 assert.deepEqual({incoming:f.incoming,outbound:f.outbound,review:f.review,c:f.c},saved);
 const verified=[...f.markers.values()].find(x=>x.result.state==='verified');
 assert(verified.provider.includes(commit));assert.equal(verified.result.verifiedByRelease,execution);assert.equal(verified.result.phoneRoutingVerification,'branch-phone-list-v1');
 assert(![...f.markers.keys()].some(key=>key.includes(execution)),'Resume uses only the original creation markers');
 const printed=publicSellerTurnStage(result);assert.equal(printed.release,commit);assert.equal(printed.verifiedByRelease,execution);assert.equal(printed.phoneRoutingVerification,'branch-phone-list-v1');
 const again=await stageSellerVoiceTurns(f.env,f.fetcher,now+2000);assert.deepEqual(again,result);
 Object.assign(f.env,{VERCEL_GIT_COMMIT_SHA:'d'.repeat(40),ICASH_SELLER_TURN_STAGE_COMMIT:'d'.repeat(40)});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now+3000),/SELLER_TURNS_FINAL_RECEIPT_CHANGED/);
 assert.equal(verified.result.verifiedByRelease,execution,'A later execution cannot rewrite an existing verification');
}
for(const direction of ['outbound','inbound']){
 const f=await unfinishedPair();f.markers.delete('seller_voice_turns_20261114_'+commit+'_'+direction);const before=f.calls.length;
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now+1000),/SELLER_TURNS_RESUME_RECEIPT_REQUIRED/);
 const calls=f.calls.slice(before);assertResumeHasNoCreates(calls);assert(!calls.some(x=>x.method==='PATCH'),'Both original receipt bindings must pass before either candidate save');
}
for(const direction of ['outbound','inbound']){
 const f=await unfinishedPair(),candidate=[...f.agents.values()].find(a=>a.name?.endsWith('-'+direction));f.agents.delete(candidate.branch_id);const before=f.calls.length;
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now+1000),/SELLER_TURNS_CREATE_UNCONFIRMED_NO_RETRY/);
 assertResumeHasNoCreates(f.calls.slice(before));assert.equal(f.creationCount,2);
}
for(const mutate of [
 receipt=>{receipt.bindingHash='a'.repeat(64);},receipt=>{receipt.release=execution;},receipt=>{receipt.name+=' changed';},
 receipt=>{receipt.source.versionId='agtvrsn_other';},receipt=>{receipt.nonce='invalid';},receipt=>{receipt.state='verified';},receipt=>{receipt.activated=true;},
]){
 const f=await unfinishedPair();mutate([...f.markers.values()][1].result);const before=f.calls.length;
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now+1000),/SELLER_TURNS_MARKER_BINDING_CHANGED/);
 const calls=f.calls.slice(before);assertResumeHasNoCreates(calls);assert(!calls.some(x=>x.method==='PATCH'));
}
for(const value of ['invalid',commit,'B'.repeat(40)]){
 const f=fixture();f.env.ICASH_SELLER_TURN_RESUME_RELEASE=value;
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_RESUME_RELEASE_REQUIRED/);assert.equal(f.calls.length,0);
}
for(const mutate of [env=>{delete env.ICASH_SELLER_TURN_STAGE_COMMIT;},env=>{env.ICASH_SELLER_TURN_STAGE_COMMIT=commit;}]){
 const f=fixture();resumeEnv(f);mutate(f.env);
 assert.deepEqual(await stageSellerVoiceTurns(f.env,f.fetcher,now),{status:'not_requested'});assert.equal(f.calls.length,0,'An old resume release alone cannot request staging from a new execution');
}
{
 const f=fixture();resumeEnv(f);f.env.VERCEL_ENV='preview';
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_COMMIT_REQUIRED/);assert.equal(f.calls.length,0);
}
for(const options of [{claimLost:true},{createLostWithoutBranch:true}]){
 const f=fixture(options);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_/);resumeEnv(f);const before=f.calls.length;
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now+1000),/SELLER_TURNS_RESUME_RECEIPT_REQUIRED/);assertResumeHasNoCreates(f.calls.slice(before));
}
for(const mutate of [f=>f.env.VERCEL_ENV='preview',f=>f.env.ICASH_SELLER_TURN_SOURCE_JSON='{}',f=>f.env.SUPABASE_URL='https://other.supabase.co',f=>f.c.config_hash='a'.repeat(64),f=>f.outbound.conversation_config.agent.prompt.prompt+=' drift',f=>f.tools.get(f.c.stop_tool_id).tool_config.api_schema.url='https://untrusted.invalid']){
 const f=fixture();mutate(f);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),undefined,String(mutate));assert.equal(f.creationCount,0);assert.equal(f.markers.size,0);
}
for(const onlyFinal of [true,false]){
 const f=fixture({mutateToolRead:(tool,{read,final})=>{if(!onlyFinal||final)tool.usage_stats={avg_latency_secs:1+read/10,total_calls:10+read};}}),before=structuredClone([...f.tools]);
 assert.equal((await stageSellerVoiceTurns(f.env,f.fetcher,now)).status,'staged','Normal tool usage must not look like a changed definition');
 assert.deepEqual([...f.tools],before,'Telemetry comparison never rewrites provider evidence');
}
{
 const f=await unfinishedPair(),before=f.calls.length;
 f.options.mutateToolRead=(tool,{read})=>{tool.usage_stats={avg_latency_secs:read/10,total_calls:read};};
 const result=await stageSellerVoiceTurns(f.env,f.fetcher,now+1000);
 assert.equal(result.status,'staged');assert.equal(result.providerWrites,0);assert.equal(f.creationCount,2);
 assertResumeHasNoCreates(f.calls.slice(before));
}
for(const options of [
 {omitUsageStats:true},
 {mutateToolRead:(tool,{final})=>{if(final)delete tool.usage_stats.total_calls;}},
 {mutateToolRead:tool=>{delete tool.usage_stats.total_calls;}},
]){const f=fixture(options);assert.equal((await stageSellerVoiceTurns(f.env,f.fetcher,now)).status,'staged');}
for(const omitUsageStats of [false,true]){
 const f=fixture({omitUsageStats,mutateToolRead:(tool,{final})=>{if(final){if(omitUsageStats)tool.usage_stats={avg_latency_secs:0,total_calls:0};else delete tool.usage_stats;}}});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_FINAL_TOOL_DEFINITIONS_CHANGED/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'),'Missing telemetry never silently equals a present wrapper');
}
for(const onlyFinal of [false,true])for(const stats of [
 null,{},[],false,'invalid',{avg_latency_secs:null},{avg_latency_secs:'1'},{avg_latency_secs:-1},{avg_latency_secs:Infinity},
 {avg_latency_secs:1,total_calls:null},{avg_latency_secs:1,total_calls:'1'},{avg_latency_secs:1,total_calls:-1},
 {avg_latency_secs:1,total_calls:1.5},{avg_latency_secs:1,total_calls:Number.MAX_SAFE_INTEGER+1},
 {avg_latency_secs:1,total_calls:1,unknown:0},
]){
 const f=fixture({mutateToolRead:(tool,{final})=>{if(!onlyFinal||final)tool.usage_stats=structuredClone(stats);}});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_TOOL_USAGE_STATS_INVALID/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'));
 if(!onlyFinal){assert.equal(f.creationCount,0);assert.equal(f.markers.size,0);}
}
for(const change of [
 tool=>{tool.id='tool_other';},tool=>{tool.tool_config.description='changed';},
 tool=>{tool.tool_config.api_schema.url='https://untrusted.invalid';},
 tool=>{tool.tool_config.api_schema.request_headers.Authorization={variable_name:'secret__other'};},
 tool=>{tool.response_mocks=[{mock_result:'unreviewed',parameter_conditions:[]}];},
 tool=>{tool.access_info.role='reader';},tool=>{tool.unknown=null;},tool=>{tool.tool_config.unknown=false;},
]){
 const f=fixture({mutateToolRead:(tool,{final})=>{if(final){tool.usage_stats.total_calls++;change(tool);}}});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_FINAL_TOOL_DEFINITIONS_CHANGED/);
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'),'Telemetry changes never mask definition, access, mocks or unknown-field drift');
}
{
 const f=fixture({mutateToolRead:(tool,{read})=>{if(tool.tool_config.name==='icash_stop_reception_recording'&&read===2)tool.access_info.role='reader';}});
 await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),/SELLER_TURNS_SOURCE_TOOLS_CHANGED/);
 assert.equal(f.creationCount,0);assert.equal(f.markers.size,0);
}
for(const [options,code] of [
 [{mutateFinalConfig:config=>{config.enabled=false;}},'DATABASE_CONFIG'],
 [{mutateFinalSource:agent=>{if(agent.agent_id===outTarget.agentId)agent.version_id='agtvrsn_other';}},'OUTBOUND_IDENTITY'],
 [{mutateFinalSource:agent=>{if(agent.agent_id===outTarget.agentId)agent.conversation_config.turn.turn_timeout++;}},'OUTBOUND_CONFIG'],
 [{mutateFinalSource:agent=>{if(agent.agent_id===receptionTarget.agentId)agent.version_id='agtvrsn_other';}},'INBOUND_IDENTITY'],
 [{mutateFinalSource:agent=>{if(agent.agent_id===receptionTarget.agentId)agent.conversation_config.turn.turn_timeout++;}},'INBOUND_CONFIG'],
 [{mutateFinalWorkspace:workspace=>{workspace.webhooks.post_call_webhook_id='hook_changed';}},'WORKSPACE'],
]){
 const f=fixture(options);await assert.rejects(stageSellerVoiceTurns(f.env,f.fetcher,now),new RegExp('SELLER_TURNS_FINAL_'+code+'_CHANGED'));
 assert(![...f.markers.values()].some(x=>x.result.state==='verified'),'Each original final source guard remains enforced');
}
console.log('PASS exact-commit seller turn staging: actual inbound/outbound validators, two isolated branches, fresh branch routing proofs, unchanged sources/tools/authority, bound newer-release resume without provider writes, unknown-write GET-only recovery, drift rejection, no activation or paid calls, sanitized output.');
