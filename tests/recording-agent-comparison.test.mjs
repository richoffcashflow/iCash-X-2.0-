import assert from 'node:assert/strict';
import test from 'node:test';
import {automaticOfferGuardrails} from '../lib/automatic-offer-policy.ts';
import {canonical,sha,recordingAgentMatches,recordingPolicy,readRecordingReview} from '../lib/required-call-recording.ts';

// Synthetic, offline fixtures only. Keep all historical hash representations
// pinned independently of the comparison so this never changes stored reviews.
const emptySubagents=()=>({agents:[],self_subagent:null});
function fixture(withEmptyDefault=false,withEmptyList=false){
 const agent={
  agent_id:'agent_fixture',branch_id:'agtbrch_recorded',main_branch_id:'agtbrch_main',version_id:'agtvrsn_reviewed',
  conversation_config:{
   asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000',voice_id:'voice_fixture'},
   conversation:{max_duration_seconds:600},
   agent:{first_message:'Synthetic first message',prompt:{prompt:'Synthetic reviewed prompt',llm:'fixture-model',tool_ids:['tool_callback','tool_handoff','tool_stop'],tools:[{type:'system',name:'end_call'}]}},
  },
  platform_settings:{
   privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},
   overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}},
  },
 };
 if(withEmptyDefault)agent.conversation_config.agent.subagent_config=emptySubagents();
 if(withEmptyList)agent.conversation_config.agent.subagents=[];
 return agent;
}
function configHash(a){
 return sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})));
}
function reviewFor(a){
 return {enabled:true,reviewedAt:'2026-10-01T00:00:00Z',reviewedUntil:'9999-12-31T23:59:59Z',agentId:a.agent_id,branchId:a.branch_id,versionId:a.version_id,configHash:configHash(a),fromPhone:'+12125550101',providerAccountSid:'AC'+'a'.repeat(32),stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
}
const legacyHash='9e42ced461a3ded8119440d39a752274f2206894af33351048b6a4d2293e8eaf';
const currentHash='5de940f218242fef502b83c68829447368af8dda908d5469e0e5817549e9a741';
const listHash='5c5b0c31aad194adca4b9c67786f1bfb21764ad75d7d6ea023ad8c3a0d71bc54';
const bothHash='875eb33f2156f6a7e6305606b6ea3dd2868cadbc336c4a269b7497d3a9d3ec82';
const representations=[[false,false],[true,false],[false,true],[true,true]];
const reviews=representations.map(([empty,list])=>reviewFor(fixture(empty,list)));

test('all four approved empty-default representations match without changing saved hashes',()=>{
 assert.equal(configHash(fixture()),legacyHash);
 assert.equal(configHash(fixture(true)),currentHash);
 assert.equal(configHash(fixture(false,true)),listHash);
 assert.equal(configHash(fixture(true,true)),bothHash);
 assert.equal(new Set(reviews.map(review=>review.configHash)).size,4);
 assert.notEqual(legacyHash,currentHash);
 for(const review of reviews){
  assert(readRecordingReview(JSON.stringify(review),Date.parse('2026-10-19T00:00:00Z')));
  for(const [empty,list] of representations)assert.equal(recordingAgentMatches(review,fixture(empty,list)),true);
 }
});

test('ordinary exact-hash reviews retain their behavior and wrong hashes fail',()=>{
 for(const subagents of [{agents:[{agent_id:'agent_reviewed'}],self_subagent:null},{agents:[],self_subagent:{agent_id:'agent_self'}},{agents:[],self_subagent:null,reviewed_extension:false}]){
  const agent=fixture();agent.conversation_config.agent.subagent_config=subagents;
  assert.equal(recordingAgentMatches(reviewFor(agent),agent),true,'explicitly reviewed content still matches exactly');
 }
 for(const [empty,list] of representations){
  const agent=fixture(empty,list);
  assert.equal(recordingAgentMatches({...reviewFor(agent),configHash:'0'.repeat(64)},agent),false);
  const reordered=JSON.parse(JSON.stringify(agent),(_key,value)=>value&&!Array.isArray(value)&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse()):value);
  assert.equal(recordingAgentMatches(reviewFor(agent),reordered),true);
 }
});

test('incoming disabled PVC compatibility does not loosen outbound approval checks',()=>{
 const original=fixture(),review=reviewFor(original),expanded=structuredClone(original);
 expanded.conversation_config.tts.pvc_strength=0;
 expanded.platform_settings.overrides.conversation_config_override.tts.pvc_strength=false;
 assert.equal(recordingAgentMatches(review,original),true);
 assert.equal(recordingAgentMatches(review,expanded),false);
 assert.equal(recordingAgentMatches(reviewFor(expanded),expanded),true);
});

function renamedVoiceFixture(){
 const old=fixture(false,true);old.conversation_config.tts.pvc_strength=0;
 old.platform_settings.overrides.conversation_config_override.tts.pvc_strength=false;
 const current=structuredClone(old);
 delete current.conversation_config.tts.pvc_strength;
 delete current.platform_settings.overrides.conversation_config_override.tts.pvc_strength;
 current.conversation_config.tts.clone_strength=0;
 current.platform_settings.overrides.conversation_config_override.tts.clone_strength=false;
 return {old,current,review:reviewFor(old)};
}
test('only the observed joint zero/false voice rename reconstructs the same approved outbound fingerprint',()=>{
 const {old,current,review}=renamedVoiceFixture(),saved=structuredClone(review);
 assert.notEqual(configHash(current),review.configHash);
 for(const [empty,list] of representations){
  const a=structuredClone(current);delete a.conversation_config.agent.subagents;
  if(empty)a.conversation_config.agent.subagent_config=emptySubagents();
  if(list)a.conversation_config.agent.subagents=[];
  const before=structuredClone(a);assert.equal(recordingAgentMatches(review,a),true);
  assert.deepEqual(a,before);assert.deepEqual(review,saved);
 }
 assert.equal(recordingAgentMatches(reviewFor(current),old),false,'field renaming is not invented in reverse');
 assert.equal(recordingAgentMatches(reviewFor(fixture()),current),false,'outbound fields cannot be omitted from the approval');
 for(const mutate of [
  a=>a.conversation_config.tts.clone_strength=0.1,a=>a.conversation_config.tts.clone_strength=null,
  a=>a.conversation_config.tts.clone_strength='0',a=>delete a.conversation_config.tts.clone_strength,
  a=>a.platform_settings.overrides.conversation_config_override.tts.clone_strength=true,
  a=>a.platform_settings.overrides.conversation_config_override.tts.clone_strength=null,
  a=>a.platform_settings.overrides.conversation_config_override.tts.clone_strength='false',
  a=>delete a.platform_settings.overrides.conversation_config_override.tts.clone_strength,
  a=>a.conversation_config.tts.pvc_strength=0,
  a=>a.platform_settings.overrides.conversation_config_override.tts.pvc_strength=false,
  a=>a.conversation_config.tts.extra=0,a=>a.platform_settings.overrides.conversation_config_override.tts.extra=false,
  a=>a.conversation_config.tts.voice_id='voice_other',a=>a.conversation_config.agent.prompt.prompt+=' changed',
  a=>a.conversation_config.agent.prompt.tool_ids.push('tool_extra'),a=>a.workflow={nodes:[]},
  a=>a.version_id='agtvrsn_other',a=>a.branch_id='agtbrch_other',a=>a.agent_id='agent_other',
  a=>a.platform_settings.privacy.record_voice=true,a=>a.platform_settings.auth.enable_auth=false,
 ]){const a=structuredClone(current);mutate(a);assert.equal(recordingAgentMatches(review,a),false,mutate.toString());}
 assert.equal(recordingAgentMatches({...review,configHash:'0'.repeat(64)},current),false);
});

test('nonempty, malformed and extended subagent values are not empty defaults',()=>{
 const invalid=[null,[],false,0,'',{},
  {agents:[]},{self_subagent:null},{agents:null,self_subagent:null},{agents:{},self_subagent:null},
  {agents:'',self_subagent:null},{agents:[null],self_subagent:null},{agents:[{agent_id:'agent_other'}],self_subagent:null},
  {agents:[],self_subagent:{}},{agents:[],self_subagent:[]},{agents:[],self_subagent:false},{agents:[],self_subagent:'agent_other'},
  {agents:[],self_subagent:null,enabled:false},{agents:[],self_subagent:null,unknown:null},
 ];
 for(const value of invalid){
  const agent=fixture();agent.conversation_config.agent.subagent_config=value;
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,JSON.stringify(value));
  const explicitReview=reviewFor(agent);
  for(const [empty,list] of representations)assert.equal(recordingAgentMatches(explicitReview,fixture(empty,list)),false,'equivalence must fail in reverse too');
 }
});

test('subagents must be an exact empty array or remain part of the exact approved hash',()=>{
 for(const value of [null,{},false,0,'',{agents:[]},[null],['agent_other'],[{agent_id:'agent_other'}]]){
  for(const empty of [false,true]){
   const agent=fixture(empty);agent.conversation_config.agent.subagents=value;
   for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,JSON.stringify(value));
   const explicitReview=reviewFor(agent);
   assert.equal(recordingAgentMatches(explicitReview,agent),true,'explicitly reviewed list content still matches exactly');
   for(const [defaultConfig,defaultList] of representations)assert.equal(recordingAgentMatches(explicitReview,fixture(defaultConfig,defaultList)),false,'nondefault content cannot disappear in reverse');
  }
 }
});

test('one empty default may vary while the other nonempty or extended field stays exactly reviewed',()=>{
 for(const value of [{agents:[{agent_id:'agent_reviewed'}],self_subagent:null},{agents:[],self_subagent:null,reviewed_extension:false}]){
  const agent=fixture(false,true);agent.conversation_config.agent.subagent_config=value;
  const review=reviewFor(agent),counterpart=structuredClone(agent);delete counterpart.conversation_config.agent.subagents;
  assert.equal(recordingAgentMatches(review,counterpart),true);
  counterpart.conversation_config.agent.subagent_config=emptySubagents();
  assert.equal(recordingAgentMatches(review,counterpart),false,'real subagent configuration is never normalized');
 }
 const agent=fixture(true);agent.conversation_config.agent.subagents=[{agent_id:'agent_reviewed'}];
 const counterpart=structuredClone(agent);delete counterpart.conversation_config.agent.subagent_config;
 assert.equal(recordingAgentMatches(reviewFor(agent),counterpart),true);
 counterpart.conversation_config.agent.subagents=[];
 assert.equal(recordingAgentMatches(reviewFor(agent),counterpart),false);
});

test('prompt, tools, voice, workflow and procedures drift still fail for all hashes',()=>{
 const changes=[
  a=>a.conversation_config.agent.prompt.prompt='Unreviewed prompt',
  a=>a.conversation_config.agent.prompt.llm='unreviewed-model',
  a=>a.conversation_config.agent.first_message='Unreviewed first message',
  a=>a.conversation_config.agent.prompt.tool_ids.reverse(),
  a=>a.conversation_config.agent.prompt.tool_ids[0]='tool_other',
  a=>a.conversation_config.agent.prompt.tool_ids.push('tool_extra'),
  a=>a.conversation_config.agent.prompt.tools[0].name='unreviewed_tool',
  a=>a.conversation_config.tts.voice_id='voice_other',
  a=>a.workflow={nodes:[]},
  a=>a.procedures=[],
 ];
 for(const change of changes)for(const [empty,list] of representations){
  const agent=fixture(empty,list);change(agent);
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,change.toString());
 }
});

test('unknown fields remain in the fingerprint at every projected level',()=>{
 const changes=[
  a=>a.conversation_config.unknown=null,
  a=>a.conversation_config.agent.unknown=false,
  a=>a.conversation_config.agent.prompt.unknown=[],
  a=>a.conversation_config.tts.unknown='',
  a=>a.platform_settings.unknown={},
  a=>a.platform_settings.privacy.unknown=false,
  a=>a.platform_settings.overrides.conversation_config_override.agent.subagent_config=emptySubagents(),
  a=>a.platform_settings.overrides.conversation_config_override.agent.subagents=[],
 ];
 for(const change of changes)for(const [empty,list] of representations){
  const agent=fixture(empty,list);change(agent);
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,change.toString());
 }
});

test('independent identity and security checks cannot be bypassed by a matching hash',()=>{
 const changes=[
  a=>a.agent_id='agent_other',a=>a.branch_id='agtbrch_other',a=>a.version_id='agtvrsn_other',
  a=>a.main_branch_id=a.branch_id,a=>a.main_branch_id='invalid',a=>delete a.main_branch_id,
  a=>a.platform_settings.privacy.record_voice=true,a=>a.platform_settings.auth.enable_auth=false,
  a=>a.platform_settings.call_limits.bursting_enabled=true,a=>a.platform_settings.queueing_config.enabled=true,
  a=>a.conversation_config.asr.user_input_audio_format='pcm_16000',a=>a.conversation_config.tts.agent_output_audio_format='pcm_16000',
  a=>a.conversation_config.conversation.max_duration_seconds=601,
  a=>a.platform_settings.overrides.conversation_config_override.conversation.max_duration_seconds=false,
  a=>a.platform_settings.overrides.conversation_config_override.agent.first_message=false,
  a=>a.platform_settings.overrides.conversation_config_override.agent.prompt.prompt=false,
  a=>a.platform_settings.overrides.conversation_config_override.tts.voice_id=false,
  a=>a.conversation_config.agent.prompt.tool_ids[0]='tool_other',
  a=>a.conversation_config.agent.prompt.tool_ids.push('tool_extra'),
 ];
 for(const change of changes)for(const [empty,list] of representations){
  const agent=fixture(empty,list);change(agent);
  assert.equal(recordingAgentMatches({...reviews[0],configHash:configHash(agent)},agent),false,change.toString());
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,change.toString());
 }
 for(const value of [null,[],{},false])assert.equal(recordingAgentMatches(reviews[0],value),false);
});

test('automatic-offer guardrails remain independently required with every representation',()=>{
 for(const [empty,list] of representations){
  const agent=fixture(empty,list);agent.platform_settings.guardrails=automaticOfferGuardrails();
  agent.conversation_config.agent.prompt.tool_ids.push('tool_contract');
  const review={...reviewFor(agent),offerPolicy:'automatic_offer_v6',contractToolId:'tool_contract',toolIds:[...reviews[0].toolIds,'tool_contract']};
  assert.equal(recordingAgentMatches(review,agent),true);
  const counterpart=structuredClone(agent);
  if(empty)delete counterpart.conversation_config.agent.subagent_config;
  else counterpart.conversation_config.agent.subagent_config=emptySubagents();
  assert.equal(recordingAgentMatches(review,counterpart),true);
  for(const change of [a=>delete a.platform_settings.guardrails,a=>a.platform_settings.guardrails.focus.is_enabled=false,a=>a.platform_settings.guardrails.custom.config.configs[0].is_enabled=false,a=>a.platform_settings.guardrails.custom.config.configs[0].prompt='Unreviewed guardrail']){
   const bad=structuredClone(counterpart);change(bad);
   assert.equal(recordingAgentMatches(review,bad),false);
   assert.equal(recordingAgentMatches({...review,configHash:configHash(bad)},bad),false,'even an exact hash cannot override required guardrails');
  }
 }
});

test('comparison never mutates a frozen review or provider snapshot',()=>{
 function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
 for(const [empty,list] of representations)for(const originalReview of reviews){
  const agent=freeze(fixture(empty,list)),review=freeze(structuredClone(originalReview)),beforeAgent=structuredClone(agent),beforeReview=structuredClone(review);
  assert.equal(recordingAgentMatches(review,agent),true);
  assert.deepEqual(agent,beforeAgent);assert.deepEqual(review,beforeReview);
  assert.equal(configHash(agent),reviews[representations.findIndex(([configPresent,listPresent])=>configPresent===empty&&listPresent===list)].configHash);
 }
});
