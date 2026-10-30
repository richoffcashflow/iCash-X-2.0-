// Offline only: no provider calls or production environment.
import assert from 'node:assert/strict';
import test from 'node:test';
import {recoverVoiceConfiguration} from '../lib/voice-configuration-recovery.ts';
import {refreshVoiceCapacity} from '../lib/voice-capacity.ts';
import {canonical,sha,recordingPolicy} from '../lib/required-call-recording.ts';
const now=Date.parse('2026-10-30T18:00:00Z');
function fixture(){
 const agent={agent_id:'agent_fixture',branch_id:'agtbrch_reviewed',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',
  conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{prompt:'Fixture',tool_ids:['tool_stop','tool_callback','tool_handoff']}}},
  platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},queueing_config:{enabled:false},call_limits:{agent_concurrency_limit:18,daily_limit:1000,bursting_enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
 const review={enabled:true,reviewedAt:'2026-10-01T00:00:00Z',reviewedUntil:'9999-12-31T23:59:59Z',agentId:agent.agent_id,branchId:agent.branch_id,versionId:agent.version_id,
  configHash:sha(JSON.stringify(canonical({conversation_config:agent.conversation_config,platform_settings:agent.platform_settings,workflow:null,procedures:null}))),
  fromPhone:'+12125550101',providerAccountSid:'AC'+'a'.repeat(32),stopToolId:'tool_stop',toolIds:['tool_stop','tool_callback','tool_handoff'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_PROVIDER:'github',VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_REPO_OWNER:'richoffcashflow',VERCEL_GIT_REPO_SLUG:'iCash-X-2.0-',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),
  ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',TWILIO_ACCOUNT_SID:review.providerAccountSid,TWILIO_AUTH_TOKEN:'fixture',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)};
 return {agent,review,env};
}
test('verified unchanged configuration only queues bounded recovery and preserves its approval',async()=>{
 const f=fixture(),before=JSON.stringify(f),calls=[];
 const result=await recoverVoiceConfiguration(async(...args)=>{calls.push(args);return 4;},f.agent,f.env,now);
 assert.deepEqual(result,{status:'checked',requeued:4});assert.equal(JSON.stringify(f),before);
 assert.equal(calls.length,1);assert.equal(calls[0][0],'rpc/icash_recover_voice_configuration');assert.equal(calls[0][1],'POST');
 assert.deepEqual(calls[0][2],{p_agent:f.review.agentId,p_config_hash:f.review.configHash,p_observed_hash:f.review.configHash,p_release:f.env.VERCEL_GIT_COMMIT_SHA,p_checked_at:new Date(now).toISOString()});
});
test('preview, disabled release, mismatched account, expired review and real provider drift never recover',async()=>{
 const variants=[f=>f.env.VERCEL_ENV='preview',f=>f.env.VERCEL_GIT_COMMIT_REF='feature',f=>f.env.VERCEL_GIT_COMMIT_SHA='bad',f=>f.env.VERCEL_GIT_REPO_OWNER='other',
  ...['ICASH_LIVE_WORK_READY','ICASH_RECORDED_OUTBOUND_READY','ICASH_RECORDING_RECEIPTS_READY'].map(key=>f=>f.env[key]='false'),
  f=>f.env.TWILIO_ACCOUNT_SID='AC'+'b'.repeat(32),f=>delete f.env.TWILIO_AUTH_TOKEN,
  f=>f.env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify({...f.review,reviewedUntil:'2026-10-01T00:00:00Z'}),
  f=>f.agent.version_id='agtvrsn_other',f=>f.agent.conversation_config.agent.prompt.prompt='Changed',f=>f.agent.platform_settings.privacy.record_voice=true];
 for(const mutate of variants){const f=fixture();mutate(f);let calls=0;const r=await recoverVoiceConfiguration(async()=>{calls++;},f.agent,f.env,now);assert.equal(r.requeued,0);assert.equal(calls,0);}
});
test('unknown database outcome is not automatically retried',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(()=>recoverVoiceConfiguration(async()=>{calls++;throw Error('offline uncertainty');},f.agent,f.env,now));assert.equal(calls,1);
 for(const value of [null,undefined,'1',21,-1])await assert.rejects(()=>recoverVoiceConfiguration(async()=>value,f.agent,f.env,now),/UNCONFIRMED/);
});
test('capacity reuses the exact global reviewed-branch read only after complete metadata and a saved available balance',async()=>{
 for(const mode of ['available','exhausted','unknown','save_failure','incoming_only','wrong_branch']){
  const f=fixture(),events=[],reads=[];let observed;
  const db=async(path)=>{events.push(path);if(path.endsWith('targets'))return [{agentId:f.agent.agent_id,branchId:mode==='incoming_only'?f.agent.branch_id:null}];if(mode==='save_failure')throw Error('offline save failure');};
  const read=async(path,region)=>{reads.push({path,region});if(path.includes('subscription'))return {tier:'pro',character_count:mode==='unknown'?null:mode==='exhausted'?100:10,character_limit:100,max_credit_limit_extension:0,can_extend_character_limit:false};return {...f.agent,branch_id:mode==='wrong_branch'?'agtbrch_other':f.agent.branch_id};};
  const action=()=>refreshVoiceCapacity(db,read,f.review,async a=>{events.push('recovery');observed=a;});
  if(mode==='save_failure')await assert.rejects(action);else await action();
  assert.equal(reads.length,2,'no extra provider requests');assert.equal(events.includes('recovery'),mode==='available');
  if(mode==='available'){assert.equal(observed.agent_id,f.agent.agent_id);assert.equal(events.at(-2),'rpc/icash_save_voice_capacity');assert.equal(reads[1].region,'global');}
 }
});
