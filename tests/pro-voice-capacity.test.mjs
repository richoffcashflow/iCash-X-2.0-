// Offline provider fixtures only. These tests never call ElevenLabs.
import assert from 'node:assert/strict';
import test from 'node:test';
import {applyApprovedProVoiceCapacity} from '../lib/approved-pro-voice-capacity.ts';
import {outboundProApproval as approval} from '../lib/outbound-parallel-approval.ts';
import {recordingAgentMatches,canonical,sha,recordingPolicy} from '../lib/required-call-recording.ts';
const now=Date.parse('2026-10-26T19:00:00Z');
const hash=a=>sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})));
function fixture(){
 const agent={agent_id:approval.agentId,branch_id:approval.branchId,version_id:approval.versionId,main_branch_id:'agtbrch_main',
  conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{prompt:'Offline reviewed prompt',tool_ids:['tool_stop','tool_callback','tool_handoff']}}},
  platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},queueing_config:{enabled:false},call_limits:{agent_concurrency_limit:2,daily_limit:100,bursting_enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
 const review={enabled:true,reviewedAt:'2026-10-01T00:00:00Z',reviewedUntil:'9999-12-31T23:59:59Z',agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash:hash(agent),fromPhone:'+12125550101',providerAccountSid:'AC'+'a'.repeat(32),stopToolId:'tool_stop',toolIds:['tool_stop','tool_callback','tool_handoff'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
 agent.platform_settings.call_limits.agent_concurrency_limit=8;
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_PROVIDER:'github',VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),ELEVENLABS_API_KEY:'offline-fixture-key'};
 return {agent,review,env};
}
function database(initial='ready'){
 let status=initial;const events=[];
 const db=async(path,method,body)=>{
  assert.equal(path,'rpc/icash_pro_voice_capacity_change');assert.equal(method,'POST');events.push(body.p_action);
  let claimed=false;
  if(body.p_action==='claim'&&status==='ready'){status='claimed';claimed=true;}
  if(body.p_action==='complete'&&status==='claimed')status='applied';
  return {status,claimed};
 };
 return {db,events,status:()=>status};
}
function provider(agent,{tier='pro',used=10,limit=600000,writeFailure=false,acceptedOnFailure=false,drift=false,mainMismatch=false,readbackFailure=false}={}){
 let current=structuredClone(agent),patches=0;const requests=[];
 const fetcher=async(url,options)=>{
  requests.push({url,method:options.method});assert.equal(new URL(url).hostname,'api.elevenlabs.io');assert.equal(options.redirect,'error');
  const parsed=new URL(url);
  if(parsed.pathname==='/v1/user/subscription'){assert.equal(options.method,'GET');return Response.json({tier,character_count:used,character_limit:limit,max_credit_limit_extension:0,can_extend_character_limit:false});}
  assert.equal(parsed.pathname,'/v1/convai/agents/'+approval.agentId,'the incoming agent is never edited');
  if(options.method==='PATCH'){
   patches++;assert.equal(parsed.searchParams.get('branch_id'),'agtbrch_main');
   assert.deepEqual(JSON.parse(options.body),{platform_settings:{call_limits:{agent_concurrency_limit:18,daily_limit:1000,bursting_enabled:false}}});
   if(!writeFailure||acceptedOnFailure)Object.assign(current.platform_settings.call_limits,{agent_concurrency_limit:18,daily_limit:1000});
   if(drift)current.conversation_config.agent.prompt.prompt+=' drift';
   if(writeFailure)throw Error('private provider text must never escape');
   return Response.json(current);
  }
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  if(readbackFailure&&patches)throw Error('private readback text');
  const result=structuredClone(current);result.branch_id=parsed.searchParams.get('branch_id');
  if(mainMismatch&&result.branch_id==='agtbrch_main')result.platform_settings.call_limits.daily_limit=101;
  return Response.json(result);
 };
 return {requests,fetcher,current:()=>structuredClone(current),patches:()=>patches};
}
test('only the compatible production Git deployment can request a change',async()=>{
 const f=fixture();for(const mutate of [e=>delete e.VERCEL,e=>e.VERCEL_ENV='preview',e=>e.VERCEL_GIT_PROVIDER='gitlab',e=>e.VERCEL_GIT_COMMIT_REF='feature',e=>e.VERCEL_GIT_COMMIT_SHA='short',e=>e.VERCEL_GIT_REPO_OWNER='other',e=>e.VERCEL_GIT_REPO_SLUG='other']){
  const env={...f.env};mutate(env);let calls=0;
  assert.equal((await applyApprovedProVoiceCapacity(async()=>{calls++;},env,async()=>{calls++;},now)).status,'not_requested');assert.equal(calls,0);
 }
});
test('one minimal main-branch PATCH raises capacity and daily limit with exact readback',async()=>{
 const f=fixture(),saved=JSON.stringify(f.review),d=database(),p=provider(f.agent);
 const result=await applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now);
 assert.deepEqual(result,{status:'verified',outgoingLimit:18,dailyLimit:1000,workspaceLimit:20,providerWrites:true});
 assert.deepEqual(p.requests.map(r=>r.method),['GET','GET','GET','PATCH','GET']);
 assert.deepEqual(d.events,['status','claim','complete']);assert.equal(d.status(),'applied');
 assert.equal(JSON.stringify(f.review),saved);assert(recordingAgentMatches(f.review,p.current()));
 assert.equal((await applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now)).status,'already_verified');assert.equal(p.requests.length,5,'no later provider reads or writes after receipt');
});
test('concurrent maintenance requests cannot repeat a provider mutation',async()=>{
 const f=fixture(),d=database(),p=provider(f.agent);
 const results=await Promise.all([applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now),applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now)]);
 assert.equal(p.patches(),1);assert.equal(d.status(),'applied');assert(results.some(r=>r.status==='verified'));
});
test('lost replies reconcile from the reviewed branch and never replay a PATCH',async()=>{
 const f=fixture(),d=database(),p=provider(f.agent,{writeFailure:true,acceptedOnFailure:true});
 assert.equal((await applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now)).status,'verified');assert.equal(p.patches(),1);
 const held=database(),rejected=provider(f.agent,{writeFailure:true});
 await assert.rejects(()=>applyApprovedProVoiceCapacity(held.db,f.env,rejected.fetcher,now),/PRO_VOICE_CAPACITY_WRITE_UNCONFIRMED/);
 assert.equal((await applyApprovedProVoiceCapacity(held.db,f.env,rejected.fetcher,now)).status,'review_required');assert.equal(rejected.patches(),1);
 const delayed=database(),lost=provider(f.agent,{readbackFailure:true});
 await assert.rejects(()=>applyApprovedProVoiceCapacity(delayed.db,f.env,lost.fetcher,now));assert.equal(delayed.status(),'claimed');
 const later=provider(lost.current());assert.equal((await applyApprovedProVoiceCapacity(delayed.db,f.env,later.fetcher,now)).status,'verified');assert.equal(later.patches(),0);assert.equal(delayed.status(),'applied');
});
test('unknown claim results cannot authorize a provider write',async()=>{
 const f=fixture(),p=provider(f.agent);
 const db=async(_path,_method,body)=>{if(body.p_action==='claim')throw Error('database unavailable');return {status:'ready',claimed:false};};
 await assert.rejects(()=>applyApprovedProVoiceCapacity(db,f.env,p.fetcher,now));assert.equal(p.patches(),0);
});
test('insufficient credits/plan, burst, review changes and main drift stay untouched',async()=>{
 for(const options of [{tier:'creator'},{tier:'starter'},{tier:'unknown'},{used:600000},{mainMismatch:true}]){
  const f=fixture(),d=database(),p=provider(f.agent,options);await assert.rejects(()=>applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now));assert.equal(p.patches(),0);assert.equal(d.status(),'ready');
 }
 for(const mutate of [a=>a.platform_settings.call_limits.bursting_enabled=true,a=>a.platform_settings.call_limits.daily_limit=101,a=>a.platform_settings.call_limits.agent_concurrency_limit=9,a=>a.version_id='agtvrsn_other',a=>a.conversation_config.agent.prompt.prompt+=' changed']){
  const f=fixture();mutate(f.agent);const d=database(),p=provider(f.agent);await assert.rejects(()=>applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now));assert.equal(p.patches(),0);assert.equal(d.status(),'ready');
 }
 const f=fixture(),d=database(),p=provider(f.agent,{drift:true});await assert.rejects(()=>applyApprovedProVoiceCapacity(d.db,f.env,p.fetcher,now),/PRO_VOICE_CAPACITY_READBACK_MISMATCH/);assert.equal(d.status(),'claimed');
});
test('configuration compatibility permits only the approved identity and two-field change',()=>{
 const f=fixture();const after=structuredClone(f.agent);Object.assign(after.platform_settings.call_limits,{agent_concurrency_limit:18,daily_limit:1000});
 assert(recordingAgentMatches(f.review,f.agent));assert(recordingAgentMatches(f.review,after));
 const currentReview={...f.review,configHash:hash(f.agent)};assert(recordingAgentMatches(currentReview,after));
 for(const mutate of [a=>a.platform_settings.call_limits.agent_concurrency_limit=19,a=>a.platform_settings.call_limits.daily_limit=1001,a=>a.platform_settings.call_limits.daily_limit=100,a=>a.platform_settings.call_limits.bursting_enabled=true,a=>a.branch_id='agtbrch_other',a=>a.agent_id='agent_other',a=>a.version_id='agtvrsn_other',a=>a.conversation_config.agent.prompt.prompt+=' changed',a=>a.platform_settings.privacy.record_voice=true]){
  const changed=structuredClone(after);mutate(changed);assert.equal(recordingAgentMatches(f.review,changed),false);
 }
 assert.equal(recordingAgentMatches({...f.review,configHash:'0'.repeat(64)},after),false);
});
