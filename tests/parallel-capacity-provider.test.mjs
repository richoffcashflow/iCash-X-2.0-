// Offline fixtures: the configuration migration never dials or simulates calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {applyApprovedParallelCapacity} from '../scripts/apply-approved-parallel-capacity.mjs';
import {outboundParallelApproval as approval} from '../lib/outbound-parallel-approval.ts';
import {canonical,sha,recordingPolicy} from '../lib/required-call-recording.ts';
const now=Date.parse('2026-10-23T12:00:00Z');
function fixture(){
 const agent={agent_id:approval.agentId,branch_id:approval.branchId,version_id:approval.versionId,main_branch_id:'agtbrch_main',
  conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{prompt:'Offline reviewed prompt',tool_ids:['tool_stop','tool_callback','tool_handoff']}}},
  platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},queueing_config:{enabled:false},call_limits:{agent_concurrency_limit:2,daily_limit:1000,bursting_enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
 const configHash=sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null})));
 const review={enabled:true,reviewedAt:'2026-10-01T00:00:00Z',reviewedUntil:'9999-12-31T23:59:59Z',agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,configHash,fromPhone:'+12125550101',providerAccountSid:'AC'+'a'.repeat(32),stopToolId:'tool_stop',toolIds:['tool_stop','tool_callback','tool_handoff'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_PROVIDER:'github',VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),ICASH_PARALLEL_CAPACITY_COMMIT:'a'.repeat(40),RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),ELEVENLABS_API_KEY:'offline-fixture-key'};
 return {agent,env};
}
function provider(agent,{tier='creator',writeFailure=false,acceptedOnFailure=false,drift=false}={}){
 const requests=[];let current=structuredClone(agent);
 const fetcher=async(url,options)=>{
  requests.push({url,options});assert.equal(new URL(url).hostname,'api.elevenlabs.io');assert.equal(options.redirect,'error');
  const path=new URL(url).pathname;
  if(path==='/v1/user/subscription'){assert.equal(options.method,'GET');return Response.json({tier});}
  assert.equal(path,'/v1/convai/agents/'+approval.agentId);
  if(options.method==='PATCH'){
   assert.equal(new URL(url).searchParams.get('branch_id'),'agtbrch_main');
   assert.deepEqual(JSON.parse(options.body),{platform_settings:{call_limits:{agent_concurrency_limit:8,daily_limit:1000,bursting_enabled:false}}});
   if(!writeFailure||acceptedOnFailure)current.platform_settings.call_limits.agent_concurrency_limit=8;
   if(drift)current.conversation_config.agent.prompt.prompt+=' drift';
   if(writeFailure)throw Error('fixture network failure containing a secret that must not be emitted');
   return Response.json(current);
  }
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  return Response.json({...current,branch_id:new URL(url).searchParams.get('branch_id')});
 };
 return {requests,fetcher};
}
test('default, another commit, and imports never request provider writes',async()=>{
 const {env}=fixture();let requests=0;const fetcher=async()=>{requests++;throw Error('unexpected');};
 assert.deepEqual(await applyApprovedParallelCapacity({},fetcher,now),{status:'not_requested'});
 assert.deepEqual(await applyApprovedParallelCapacity({...env,ICASH_PARALLEL_CAPACITY_COMMIT:'b'.repeat(40)},fetcher,now),{status:'not_requested'});
 assert.equal(requests,0);
});
test('approved commit updates only main-branch call limits and verifies the unchanged review',async()=>{
 const {agent,env}=fixture(),p=provider(agent);
 assert.deepEqual(await applyApprovedParallelCapacity(env,p.fetcher,now),{status:'verified',outgoingLimit:8,workspaceLimit:10,providerWrites:true});
 assert.deepEqual(p.requests.map(r=>r.options.method),['GET','GET','GET','PATCH','GET']);
});
test('already eight is idempotent; uncertain writes reconcile without retry',async()=>{
 const {agent,env}=fixture();agent.platform_settings.call_limits.agent_concurrency_limit=8;
 const p=provider(agent);assert.equal((await applyApprovedParallelCapacity(env,p.fetcher,now)).status,'already_verified');assert.equal(p.requests.length,2);
 const fresh=fixture(),uncertain=provider(fresh.agent,{writeFailure:true,acceptedOnFailure:true});
 assert.equal((await applyApprovedParallelCapacity(fresh.env,uncertain.fetcher,now)).status,'verified');
 assert.equal(uncertain.requests.filter(r=>r.options.method==='PATCH').length,1);
 const rejected=provider(fresh.agent,{writeFailure:true});
 await assert.rejects(()=>applyApprovedParallelCapacity(fresh.env,rejected.fetcher,now),/PARALLEL_CAPACITY_WRITE_UNCONFIRMED/);
 assert.equal(rejected.requests.filter(r=>r.options.method==='PATCH').length,1);
});
test('insufficient plan, changed review, burst, wrong host or expired approval never mutates',async()=>{
 for(const mutate of [f=>f.agent.platform_settings.call_limits.bursting_enabled=true,f=>f.agent.platform_settings.call_limits.daily_limit++,f=>f.agent.version_id='agtvrsn_drift',f=>f.env.VERCEL_ENV='preview',f=>f.env.VERCEL_GIT_COMMIT_REF='unreviewed']){
  const f=fixture();mutate(f);const p=provider(f.agent);await assert.rejects(()=>applyApprovedParallelCapacity(f.env,p.fetcher,now));assert(p.requests.every(r=>r.options.method==='GET'));
 }
 for(const tier of ['free','starter','unknown']){const f=fixture(),p=provider(f.agent,{tier});await assert.rejects(()=>applyApprovedParallelCapacity(f.env,p.fetcher,now));assert(p.requests.every(r=>r.options.method==='GET'));}
 const f=fixture(),p=provider(f.agent);await assert.rejects(()=>applyApprovedParallelCapacity(f.env,p.fetcher,Date.parse('2026-10-25T00:00:00Z')));assert.equal(p.requests.length,0);
});
test('post-write drift cannot become an approval',async()=>{
 const f=fixture(),p=provider(f.agent,{drift:true});await assert.rejects(()=>applyApprovedParallelCapacity(f.env,p.fetcher,now),/PARALLEL_CAPACITY_READBACK_MISMATCH/);
});
test('explicit migration is behind the existing exact-production-commit CI gate',()=>{
 const build=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8')).buildCommand;
 assert(build.startsWith('node scripts/verify-production-release.mjs && '));
 assert(build.includes('apply-approved-parallel-capacity.mjs && node --experimental-strip-types scripts/check-telephony-connection.mjs'));
});
