import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVoiceApprovalDiagnostics} from '../lib/voice-approval-diagnostics.ts';
import {canonical,sha,recordingAgentMatches} from '../lib/required-call-recording.ts';
import {outboundProApproval as pro} from '../lib/outbound-parallel-approval.ts';
function fixture(){return {agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{prompt:'PRIVATE_REVIEWED_PROMPT',tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};}
const hash=a=>sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})));
const review=a=>({agentId:a.agent_id,branchId:a.branch_id,versionId:a.version_id,configHash:hash(a),toolIds:['tool_callback','tool_handoff','tool_stop']});
{
 const old=fixture(),approval=review(old),current=structuredClone(old);current.platform_settings.privacy.new_disabled_feature=false;
 const before=structuredClone(current),saved=structuredClone(approval),inspect=createVoiceApprovalDiagnostics();
 assert.equal(recordingAgentMatches(approval,current),false);
 const result=inspect(approval,current);assert.equal(result.observedHash,hash(current));
 assert.equal(result.matchingRemovalPath,'platform_settings.privacy.new_disabled_feature');
 assert.deepEqual(result.failedChecks,['approved_configuration_fingerprint']);
 assert.equal(recordingAgentMatches(approval,current),false,'diagnosis must never approve the original drift');
 assert.deepEqual(current,before);assert.deepEqual(approval,saved);
 assert.equal(inspect(approval,current),null,'immediate repeats do no diagnostic work');
 assert(!JSON.stringify(result).includes('PRIVATE_REVIEWED_PROMPT'));
 current.conversation_config.agent.prompt.prompt='DIFFERENT_PRIVATE_PROMPT';
 assert.equal(createVoiceApprovalDiagnostics()(approval,current).matchingRemovalPath,null,'cannot hide changed prompts');
}
for(const [change,label] of [[a=>a.version_id='agtvrsn_changed','version_identity'],[a=>a.platform_settings.privacy.record_voice=true,'recording_disabled'],[a=>a.conversation_config.agent.prompt.tool_ids.push('tool_other'),'reviewed_tool_set']]){
 const a=fixture(),approval=review(a);a.platform_settings.privacy.new_disabled_feature=false;change(a);
 const result=createVoiceApprovalDiagnostics()(approval,a);assert(result.failedChecks.includes(label));assert.equal(result.checkedCandidates,0);assert.equal(result.matchingRemovalPath,null);
}
for(const path of [['platform_settings'],['conversation_config'],['platform_settings','overrides','conversation_config_override','tts']]){
 const a=fixture(),approval=review(a);let node=a;for(const key of path)node=node[key];node.new_disabled_feature=null;
 assert.equal(createVoiceApprovalDiagnostics()(approval,a).matchingRemovalPath,[...path,'new_disabled_feature'].join('.'));
}
for(const key of ['secret_payload','api_key','token_private','authorization','password','phone_number','sk_private','constructor','__proto__']){
 const a=fixture(),approval=review(a);Object.defineProperty(a.platform_settings.privacy,key,{value:false,enumerable:true,configurable:true});
 const result=createVoiceApprovalDiagnostics()(approval,a);assert.equal(result.matchingRemovalPath,null);assert(!JSON.stringify(result).includes(key));
}
{
 const a=fixture(),approval=review(a);a.platform_settings.privacy.private_text='DO_NOT_LOG_+15555550100';a.platform_settings.privacy.dynamic_variables={private_name:false};
 const result=createVoiceApprovalDiagnostics()(approval,a);assert.equal(result.matchingRemovalPath,null);assert(!JSON.stringify(result).includes('DO_NOT_LOG'));assert(!JSON.stringify(result).includes('private_name'));
}
{
 const a=fixture();Object.assign(a,{agent_id:pro.agentId,branch_id:pro.branchId,version_id:pro.versionId});Object.assign(a.platform_settings.call_limits,{agent_concurrency_limit:pro.previousLimit,daily_limit:pro.previousDailyLimit});
 const approval=review(a);Object.assign(a.platform_settings.call_limits,{agent_concurrency_limit:pro.limit,daily_limit:pro.dailyLimit});a.conversation_config.asr.new_disabled_feature=null;
 assert.equal(createVoiceApprovalDiagnostics()(approval,a).matchingRemovalPath,'conversation_config.asr.new_disabled_feature','proof reuses exact approved capacity handling');assert.equal(recordingAgentMatches(approval,a),false);
}
{
 const a=fixture(),approval=review(a);a.platform_settings.privacy.new_disabled_feature=false;let clock=0;const inspect=createVoiceApprovalDiagnostics(()=>clock);
 assert(inspect(approval,a));clock=60_001;assert.equal(inspect(approval,a),null,'completed fingerprints stay deduplicated after cooldown');
 const changed=structuredClone(a);changed.platform_settings.privacy.other_disabled_feature=false;clock=120_002;assert(inspect(approval,changed));
}
{
 const a=fixture(),approval=review(a);for(let i=0;i<100;i++)a.platform_settings.privacy['unused_'+i]=false;
 const result=createVoiceApprovalDiagnostics(()=>0)(approval,a);assert.equal(result.checkedCandidates,64);assert.equal(result.bounded,true);
 let clock=0;const timed=createVoiceApprovalDiagnostics(()=>clock+=751)(approval,a);assert.equal(timed.checkedCandidates,0);assert.equal(timed.bounded,true);
}
for(const mutate of [a=>a.cycle=a,a=>a.conversation_config.agent.prompt.prompt='x'.repeat(65537),a=>{let p=a;for(let i=0;i<20;i++)p=p.deep={};}]){
 const a=fixture(),approval=review(a);mutate(a);const result=createVoiceApprovalDiagnostics()(approval,a);assert.equal(result.observedHash,null);assert.equal(result.bounded,true);assert.equal(result.checkedCandidates,0);
}
const dispatch=readFileSync(new URL('../lib/live-dispatch-service.ts',import.meta.url),'utf8');
assert.match(dispatch,/if\(!recordingAgentMatches\(recordedReview,agent\)\)\{[\s\S]*?voiceApprovalDiagnostics\(recordedReview,agent\)[\s\S]*?return hold\('production_agent_review_required'\)/);
assert(!dispatch.includes('if(diagnostic.matchingRemovalPath)'),'diagnostic findings never enter dispatch admission');
console.log('PASS voice diagnostics: exact saved-hash evidence only, no acceptance or mutation, redacted fixed output, identity gates and bounded deduplicated work');
