import assert from 'node:assert/strict';
import test from 'node:test';
import {automaticOfferGuardrails} from '../lib/automatic-offer-policy.ts';
import {canonical,sha,recordingAgentMatches,recordingPolicy,readRecordingReview} from '../lib/required-call-recording.ts';

// Synthetic, offline fixtures only. Keep the historical hash representations
// pinned independently of the comparison so this never changes stored reviews.
const emptySubagents=()=>({agents:[],self_subagent:null});
function fixture(withEmptyDefault=false,withEmptySubagents=false){
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
 if(withEmptySubagents)agent.conversation_config.agent.subagents=[];
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
const representationHashes=[legacyHash,currentHash,'5c5b0c31aad194adca4b9c67786f1bfb21764ad75d7d6ea023ad8c3a0d71bc54','875eb33f2156f6a7e6305606b6ea3dd2868cadbc336c4a269b7497d3a9d3ec82'];
const representations=[[false,false],[true,false],[false,true],[true,true]];
const reviews=representations.map(shape=>reviewFor(fixture(...shape)));

test('all 16 reviewed/current combinations accept only the two exact empty defaults',()=>{
 assert.deepEqual(representations.map(shape=>configHash(fixture(...shape))),representationHashes);
 assert.equal(new Set(representationHashes).size,4);
 for(const review of reviews){
  assert(readRecordingReview(JSON.stringify(review),Date.parse('2026-10-19T00:00:00Z')));
  for(const shape of representations)assert.equal(recordingAgentMatches(review,fixture(...shape)),true);
 }
});

test('ordinary exact-hash reviews retain their behavior and wrong hashes fail',()=>{
 for(const subagents of [{agents:[{agent_id:'agent_reviewed'}],self_subagent:null},{agents:[],self_subagent:{agent_id:'agent_self'}},{agents:[],self_subagent:null,reviewed_extension:false}]){
  const agent=fixture();agent.conversation_config.agent.subagent_config=subagents;
  assert.equal(recordingAgentMatches(reviewFor(agent),agent),true,'explicitly reviewed content still matches exactly');
 }
 for(const shape of representations){
  const agent=fixture(...shape);
  assert.equal(recordingAgentMatches({...reviewFor(agent),configHash:'0'.repeat(64)},agent),false);
  const reordered=JSON.parse(JSON.stringify(agent),(_key,value)=>value&&!Array.isArray(value)&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse()):value);
  assert.equal(recordingAgentMatches(reviewFor(agent),reordered),true);
 }
});

test('nonempty, malformed and extended subagent values are not empty defaults',()=>{
 const invalid=[null,[],false,0,'',{},
  {agents:[]},{self_subagent:null},{agents:null,self_subagent:null},{agents:{},self_subagent:null},
  {agents:'',self_subagent:null},{agents:[null],self_subagent:null},{agents:[{agent_id:'agent_other'}],self_subagent:null},
  {agents:[],self_subagent:{}},{agents:[],self_subagent:[]},{agents:[],self_subagent:false},{agents:[],self_subagent:'agent_other'},
  {agents:[],self_subagent:null,enabled:false},{agents:[],self_subagent:null,unknown:null},
 ];
 for(const value of invalid)for(const emptySubagents of [false,true]){
  const agent=fixture(false,emptySubagents);agent.conversation_config.agent.subagent_config=value;
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,JSON.stringify(value));
  const explicitReview=reviewFor(agent);
  for(const shape of representations)assert.equal(recordingAgentMatches(explicitReview,fixture(...shape)),false,'equivalence must fail in reverse too');
 }
});

test('nonempty and malformed subagents never become an absent or empty array',()=>{
 const invalid=[null,false,0,'',{}, {length:0},{agents:[]},{agents:[],self_subagent:null},[null],['agent_other'],[{agent_id:'agent_other'}]];
 for(const value of invalid)for(const emptyConfig of [false,true]){
  const agent=fixture(emptyConfig);agent.conversation_config.agent.subagents=value;
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,JSON.stringify(value));
  const explicitReview=reviewFor(agent);
  assert.equal(recordingAgentMatches(explicitReview,agent),true,'an existing exact hash remains authoritative');
  for(const shape of representations)assert.equal(recordingAgentMatches(explicitReview,fixture(...shape)),false,'equivalence must fail in reverse too');
 }
});

test('an unchanged reviewed nonempty field stays hashed while the other default varies',()=>{
 for(const [key,value,otherKey,otherDefault] of [
  ['subagents',[{agent_id:'agent_reviewed'}],'subagent_config',emptySubagents()],
  ['subagent_config',{agents:[{agent_id:'agent_reviewed'}],self_subagent:null},'subagents',[]],
 ]){
  const approved=fixture();approved.conversation_config.agent[key]=value;
  const current=structuredClone(approved);current.conversation_config.agent[otherKey]=otherDefault;
  assert.equal(recordingAgentMatches(reviewFor(approved),current),true);
  assert.equal(recordingAgentMatches(reviewFor(current),approved),true);
  delete current.conversation_config.agent[key];
  assert.equal(recordingAgentMatches(reviewFor(approved),current),false,'nonempty reviewed content cannot disappear');
 }
});

test('prompt, tools, voice, workflow and procedures drift still fail for every hash',()=>{
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
 for(const change of changes)for(const shape of representations){
  const agent=fixture(...shape);change(agent);
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
  a=>a.conversation_config.agent.prompt.subagents=[],
  a=>a.conversation_config.subagents=[],
 ];
 for(const change of changes)for(const shape of representations){
  const agent=fixture(...shape);change(agent);
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
 for(const change of changes)for(const shape of representations){
  const agent=fixture(...shape);change(agent);
  assert.equal(recordingAgentMatches({...reviews[0],configHash:configHash(agent)},agent),false,change.toString());
  for(const review of reviews)assert.equal(recordingAgentMatches(review,agent),false,change.toString());
 }
 for(const value of [null,[],{},false])assert.equal(recordingAgentMatches(reviews[0],value),false);
});

test('automatic-offer guardrails remain independently required with every representation',()=>{
 for(const shape of representations){
  const agent=fixture(...shape);agent.platform_settings.guardrails=automaticOfferGuardrails();
  agent.conversation_config.agent.prompt.tool_ids.push('tool_contract');
  const review={...reviewFor(agent),offerPolicy:'automatic_offer_v6',contractToolId:'tool_contract',toolIds:[...reviews[0].toolIds,'tool_contract']};
  assert.equal(recordingAgentMatches(review,agent),true);
  const counterpart=structuredClone(agent);
  if(shape[0])delete counterpart.conversation_config.agent.subagent_config;
  else counterpart.conversation_config.agent.subagent_config=emptySubagents();
  if(shape[1])delete counterpart.conversation_config.agent.subagents;
  else counterpart.conversation_config.agent.subagents=[];
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
 for(const [i,shape] of representations.entries())for(const originalReview of reviews){
  const agent=freeze(fixture(...shape)),review=freeze(structuredClone(originalReview)),beforeAgent=structuredClone(agent),beforeReview=structuredClone(review);
  assert.equal(recordingAgentMatches(review,agent),true);
  assert.deepEqual(agent,beforeAgent);assert.deepEqual(review,beforeReview);
  assert.equal(configHash(agent),representationHashes[i]);
 }
});
