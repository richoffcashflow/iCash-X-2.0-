import assert from 'node:assert/strict';
import {inspectOwnerVoice,ownerVoiceBody,ownerVoiceConfirmation} from '../lib/owner-voice-acceptance.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const config={id:1,account_id:'account',owner_user_id:'owner',phone:'+12145550123',agent_id:'agent_fixture',phone_number_id:'phnum_fixture',branch_id:'agtbrch_fixture',branch_name:'owner-test-fixture',reviewed_config_hash:null,reviewed_version_id:'agtvrsn_fixture',enabled:true,expires_at:new Date(Date.now()+3600000).toISOString()};
const agent={agent_id:config.agent_id,branch_id:config.branch_id,version_id:config.reviewed_version_id,conversation_config:{agent:{first_message:'AI test only',prompt:{tool_ids:[],tools:[],mcp_server_ids:[],knowledge_base:[]}},conversation:{max_duration_seconds:60}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false}}};
const branch={id:config.branch_id,agent_id:config.agent_id,name:config.branch_name,is_archived:false,current_live_percentage:0};
const phone={phone_number_id:config.phone_number_id,phone_number:'+12145550199',provider:'twilio'};
const check=(a=agent,b=branch,p=phone)=>inspectOwnerVoice(config,a,b,p,phone.phone_number);
assert.equal(check().guarded,true);config.reviewed_config_hash=check().hash;assert.equal(check().reviewed,true);
for(const mutate of [a=>a.conversation_config.conversation.max_duration_seconds=600,a=>a.platform_settings.privacy.record_voice=true,a=>a.platform_settings.auth.enable_auth=false,a=>a.conversation_config.agent.prompt.tool_ids=['tool_external'],a=>a.conversation_config.agent.prompt.mcp_server_ids=['mcp_external'],a=>a.workflow={nodes:{external:{type:'tool'}},edges:[]},a=>a.branch_id='agtbrch_main']){const a=structuredClone(agent);mutate(a);assert.equal(check(a).guarded,false);}
assert.equal(check(agent,{...branch,current_live_percentage:100}).guarded,false);
assert.equal(check(agent,branch,{...phone,phone_number:'+12145550198'}).guarded,false);
const changed=structuredClone(agent);changed.conversation_config.agent.first_message='Changed';assert.equal(check(changed).guarded,true);assert.equal(check(changed).reviewed,false);
const body=ownerVoiceBody(config);assert.equal(body.to_number,config.phone);assert.equal(body.conversation_initiation_client_data.branch_id,config.branch_id);assert.equal(body.conversation_initiation_client_data.conversation_config_override.conversation.max_duration_seconds,60);assert.equal(body.telephony_call_config.ringing_timeout_secs,20);assert.equal(body.call_recording_enabled,false);assert.equal(body.telephony_call_config.twilio_call_recording_enabled,false);assert(!('dynamic_variables' in body.conversation_initiation_client_data));
let writes=0,claimed=false,unknown=false,finishFails=false,configRows=[config],calls=[],runs=[],conversation={agent_id:config.agent_id,conversation_id:'conv_fixture',branch_id:config.branch_id,version_id:config.reviewed_version_id,has_audio:false,status:'done',metadata:{call_duration_secs:40}};
const env=process.env.CONTIGUITY_FROM;process.env.CONTIGUITY_FROM=phone.phone_number;
try{
 const service=await loadService('lib/owner-voice-acceptance-service.ts',{inspectOwnerVoice,ownerVoiceBody,db:async(path,method,b)=>{calls.push({path,method,body:b});if(path.startsWith('icash_owner_voice_acceptance_config'))return configRows;if(path.startsWith('icash_owner_voice_acceptance_runs'))return runs;if(path==='rpc/icash_claim_owner_voice_acceptance'){assert.equal(b.p_expected,config);if(claimed)return null;claimed=true;return {id:'run',configuration:config};}if(path==='rpc/icash_finish_owner_voice_acceptance'){if(finishFails)throw Error('Database unavailable');return null;}throw Error(path);},elevenRequest:async(path,b)=>{if(b){writes++;assert.deepEqual(b,body);if(unknown)throw Error('timeout');return {success:true,conversation_id:'conv_fixture',callSid:'CA'+'a'.repeat(32)};}if(path.includes('/conversations/'))return conversation;if(path.includes('/branches/'))return branch;if(path.includes('/phone-numbers/'))return phone;return agent;}});
 const owner={accountId:'account',userId:'owner'};
 runs=[{id:'run',state:'accepted',conversation_id:'conv_fixture',configuration:config}];
 assert.equal((await service.ownerVoiceStatus(owner)).status,'provider_done');
 for(const change of [{branch_id:'agtbrch_main'},{version_id:'agtvrsn_unreviewed'},{has_audio:true},{metadata:{call_duration_secs:61}}]){const before=conversation;conversation={...conversation,...change};assert.equal((await service.ownerVoiceStatus(owner)).status,'needs_review_no_retry');conversation=before;}
 runs=[];

 assert.equal((await service.ownerVoiceStatus(owner)).canCall,true);assert.equal(writes,0);
 assert.equal((await service.startOwnerVoiceAcceptance(owner)).status,'provider_accepted');assert.equal(writes,1);
 assert.equal((await service.startOwnerVoiceAcceptance(owner)).status,'already_claimed_or_changed');assert.equal(writes,1);
 claimed=false;unknown=true;finishFails=true;assert.equal((await service.startOwnerVoiceAcceptance(owner)).status,'needs_review_no_retry');assert.equal(writes,2);assert.equal((await service.startOwnerVoiceAcceptance(owner)).status,'already_claimed_or_changed');assert.equal(writes,2);
 config.enabled=false;assert.equal((await service.startOwnerVoiceAcceptance(owner)).status,'not_released');assert.equal(writes,2);
 assert(calls.every(c=>!c.path.includes('wallet')&&!c.path.includes('credit')&&!c.path.includes('contact_permissions')&&!c.path.includes('voice_jobs')));
 let routeCalls=0,signedIn=true;
 const route=await loadService('app/api/owner-voice-acceptance/route.ts',{NextResponse:{json:(body,o={})=>({body,status:o.status??200})},workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return owner;},ownerVoiceConfirmation,ownerVoiceStatus:async()=>({status:'not_configured'}),startOwnerVoiceAcceptance:async()=>{routeCalls++;return {status:'provider_accepted'};}});
 const request=(b,origin='https://example.test')=>new Request('https://example.test/api/owner-voice-acceptance',{method:'POST',headers:{origin},body:JSON.stringify(b)});
 assert.equal((await route.POST(request({confirmation:ownerVoiceConfirmation},'https://attacker.test'))).status,403);
 for(const b of [{phone:'+12145550129',confirmation:ownerVoiceConfirmation},{confirmation:'yes'},[]])assert.equal((await route.POST(request(b))).status,400);
 signedIn=false;assert.equal((await route.POST(request({confirmation:ownerVoiceConfirmation}))).status,401);signedIn=true;assert.equal(routeCalls,0);
 assert.equal((await route.POST(request({confirmation:ownerVoiceConfirmation}))).body.status,'provider_accepted');assert.equal(routeCalls,1);
}finally{if(env===undefined)delete process.env.CONTIGUITY_FROM;else process.env.CONTIGUITY_FROM=env;}
console.log('Owner acceptance policy/service/route: exact branch/caller/tools/privacy/cap, one-use/unknown no-retry, no wallet/business path, auth/CSRF/strict input pass. Fixture requests only.');
