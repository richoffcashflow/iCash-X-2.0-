import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import * as policy from '../lib/owner-inbound-acceptance.ts';
import {inboundAuthorized,inboundCallSchema,inboundCapability,inboundInitiation} from '../lib/inbound-voice.ts';
import {createHash,randomBytes} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
// Entirely synthetic provider responses; pinned route constants are configuration
// assertions only. No fixture calls a provider or uses a credential.
const testAccountSid='AC'+randomBytes(16).toString('hex');
const target=policy.ownerInboundTarget,now=Date.now(),owner={accountId:target.accountId,userId:target.ownerUserId};
const c={id:'10000000-0000-4000-8000-000000000001',account_id:owner.accountId,owner_user_id:owner.userId,owner_phone:target.ownerPhone,source_phone:target.sourceNumber,ingress_phone:target.ingressNumber,twilio_account_sid:testAccountSid,agent_id:target.agentId,branch_id:target.branchId,phone_number_id:target.phoneNumberId,branch_name:'owner-test-fixture',reviewed_config_hash:null,reviewed_version_id:'agtvrsn_synthetic',elevenlabs_region:'us',twilio_region:'us1',enabled:true,expires_at:new Date(now+3600000).toISOString(),approval_ref:'synthetic local approval only',quote_cap_cents:65,rate_evidence_hash:'a'.repeat(64),all_in_cost_reviewed:true,forwarding_no_incremental_cost:true,provider_extras_disabled:true};
const a={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,conversation_config:{agent:{first_message:'private synthetic test',prompt:{tool_ids:[],tools:[],mcp_server_ids:[],knowledge_base:[]}},conversation:{max_duration_seconds:60}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false},call_limits:{bursting_enabled:false},queueing_config:{enabled:false,wait_timeout_seconds:30}},workflow:JSON.parse(readFileSync('tests/fixtures/owner-start-workflow.json','utf8'))};
const branch={id:c.branch_id,agent_id:c.agent_id,name:c.branch_name,is_archived:false,current_live_percentage:0},phone={phone_number_id:c.phone_number_id,phone_number:c.ingress_phone,provider:'twilio'};
c.reviewed_config_hash=policy.inspectOwnerInbound(c,a,branch,phone,testAccountSid).hash;
assert(policy.inspectOwnerInbound(c,a,branch,phone,testAccountSid).reviewed);
for(const change of [x=>x.account_id='bad',x=>x.owner_user_id='bad',x=>x.branch_id='agtbrch_main',x=>x.owner_phone='+12145550123',x=>x.source_phone='+12145550122',x=>x.phone_number_id='phnum_outbound']){const copy=structuredClone(c);change(copy);assert(!policy.exactOwnerInboundTarget(copy,testAccountSid));}
for(const change of [x=>x.platform_settings.queueing_config.enabled=true,x=>delete x.platform_settings.queueing_config,x=>x.platform_settings.call_limits.bursting_enabled=true,x=>x.workflow.nodes.start_node.type='tool',x=>x.platform_settings.privacy.record_voice=true,x=>x.conversation_config.agent.prompt.tool_ids=['tool_fixture'],x=>x.conversation_config.agent.prompt.knowledge_base=[{}],x=>x.conversation_config.conversation.max_duration_seconds=61]){const copy=structuredClone(a);change(copy);assert(!policy.inspectOwnerInbound(c,copy,branch,phone,testAccountSid).reviewed);}
const challenge=policy.ownerInboundChallenge();assert.match(challenge.code,/^\d{8}$/);assert.match(challenge.hash,/^[a-f0-9]{64}$/);assert(!challenge.hash.includes(challenge.code));
const run={id:'20000000-0000-4000-8000-000000000001',config_id:c.id,account_id:owner.accountId,owner_user_id:owner.userId,state:'inspecting',configuration:c,armed_at:new Date(now-1000).toISOString(),expires_at:new Date(now+299000).toISOString(),challenge_salt:challenge.salt,challenge_hash:challenge.hash,provider_call_sid:'CA'+'1'.repeat(32),conversation_id:'conv_synthetic',reserved_cents:65,actual_cost_cents:null};
const tw={sid:run.provider_call_sid,account_sid:c.twilio_account_sid,from:c.owner_phone,to:c.ingress_phone,forwarded_from:c.source_phone,direction:'inbound',status:'in-progress',date_created:new Date(now).toISOString(),duration:'35'};
const conv={agent_id:c.agent_id,branch_id:c.branch_id,version_id:c.reviewed_version_id,conversation_id:run.conversation_id,has_audio:false,status:'in-progress',metadata:{start_time_unix_secs:Math.floor(now/1000),call_duration_secs:35,phone_call:{type:'twilio',direction:'inbound',call_sid:run.provider_call_sid,external_number:c.owner_phone,agent_number:c.ingress_phone}},transcript:[{role:'user',message:challenge.code}]};
assert(policy.inspectOwnerInboundInitiation(run,tw,testAccountSid,now));

for(const change of [x=>delete x.forwarded_from,x=>x.account_sid='AC'+'2'.repeat(32),x=>x.from='+12145550123',x=>x.direction='outbound-api']){const copy=structuredClone(tw);change(copy);assert(!policy.inspectOwnerInboundInitiation(run,copy,testAccountSid,now));}
assert(!policy.inspectOwnerInboundInitiation(run,tw,testAccountSid,Date.parse(run.expires_at)));
assert.throws(()=>policy.ownerInboundInitiation(run));run.state='claimed';
const initiation=policy.ownerInboundInitiation(run);assert.equal(initiation.branch_id,c.branch_id);assert.equal(initiation.conversation_config_override.conversation.max_duration_seconds,60);assert(!JSON.stringify(initiation).includes(challenge.code));assert(!JSON.stringify(initiation).includes('secret__icash_call_token'));
tw.status='completed';conv.status='done';
assert.equal(policy.reconcileOwnerInbound(run,tw,conv,testAccountSid,now).challengeResult,'passed');
const original=structuredClone(conv);conv.transcript=[{role:'agent',message:challenge.code}];assert.equal(policy.reconcileOwnerInbound(run,tw,conv,testAccountSid,now).challengeResult,'failed');
conv.transcript=[{role:'user',message:'guess'},{role:'user',message:'bad'},{role:'user',message:'again'},{role:'user',message:challenge.code}];assert.equal(policy.reconcileOwnerInbound(run,tw,conv,testAccountSid,now).challengeResult,'failed');
const words=['zero','one','two','three','four','five','six','seven','eight','nine'];conv.transcript=[{role:'user',message:[...challenge.code].map(n=>words[Number(n)]).join(' ')}];assert.equal(policy.reconcileOwnerInbound(run,tw,conv,testAccountSid,now).challengeResult,'passed');
conv.transcript=[{role:'user',message:challenge.code,tool_calls:[{tool_name:'x'}]}];assert.equal(policy.reconcileOwnerInbound(run,tw,conv,testAccountSid,now).audioResult,'needs_review');Object.assign(conv,original);
for(const change of [x=>x.metadata.call_duration_secs=61,x=>x.metadata.phone_call.external_number='+12145550123',x=>x.has_audio=true,x=>x.version_id='agtvrsn_other']){const copy=structuredClone(conv);change(copy);assert.equal(policy.reconcileOwnerInbound(run,tw,copy,testAccountSid,now).audioResult,'needs_review');}

// The trusted account is independent of both the stored row and provider receipt.
const wrongAccountSid='AC'+randomBytes(16).toString('hex');
const invalidTrustedAccounts=[undefined,null,'',0,{},'AC'+('g'.repeat(32)),'SK'+('1'.repeat(32)),testAccountSid.slice(1),testAccountSid+'0',' '+testAccountSid,testAccountSid+' ',testAccountSid+'\n',testAccountSid+'\r'];
const eventForAccount={caller_id:c.owner_phone,called_number:c.ingress_phone,agent_id:c.agent_id,call_sid:tw.sid,conversation_id:conv.conversation_id};
assert(policy.ownerInboundCostsBound(run,tw,conv,testAccountSid));
for(const expected of [...invalidTrustedAccounts,wrongAccountSid]){
 assert(!policy.exactOwnerInboundTarget(c,expected),'missing, malformed or wrong trusted account denies target');
 assert(!policy.eligibleOwnerInboundCall(c,eventForAccount,expected));
 assert(!policy.inspectOwnerInbound(c,a,branch,phone,expected).reviewed);
 assert(!policy.inspectOwnerInboundInitiation({...run,state:'inspecting'},{...tw,status:'in-progress'},expected,now));
 assert.equal(policy.reconcileOwnerInbound(run,tw,conv,expected,now).audioResult,'needs_review');
 assert(!policy.ownerInboundCostsBound(run,tw,conv,expected));
}
for(const malformed of invalidTrustedAccounts){assert(!policy.validOwnerInboundAccountSid(malformed));assert(!policy.exactOwnerInboundTarget({...c,twilio_account_sid:malformed},malformed),'two malformed values must never match');}
const movedRun={...run,configuration:{...c,twilio_account_sid:wrongAccountSid}},movedReceipt={...tw,account_sid:wrongAccountSid};
assert(!policy.exactOwnerInboundTarget(movedRun.configuration,testAccountSid));
assert(!policy.inspectOwnerInboundInitiation({...movedRun,state:'inspecting'},{...movedReceipt,status:'in-progress'},testAccountSid,now));
assert.equal(policy.reconcileOwnerInbound(movedRun,movedReceipt,conv,testAccountSid,now).audioResult,'needs_review');
assert(!policy.ownerInboundCostsBound(movedRun,movedReceipt,conv,testAccountSid),'matching foreign config and receipt still deny');

let calls=[],stored=null,fetchFails=false,claimed=false,conversationReads=0,providerFactories=0;
const fakeProviders=()=>{providerFactories++;return ({agent:async()=>a,branch:async()=>branch,phone:async()=>phone,twilio:async()=>{assert(stored?.state==='inspecting'||stored?.state==='claimed','attempt is durable before receipt GET');if(fetchFails)throw Error('unavailable');return tw;},conversation:async()=>{conversationReads++;return conv;},costs:()=>({twilioCostMicros:10000,elevenLabsCostMicros:90000})});};
const db=async(path,method,body)=>{calls.push({path,body});if(path.startsWith('icash_owner_inbound_acceptance_config'))return [c];if(path.startsWith('icash_owner_inbound_acceptance_runs'))return stored?[structuredClone(stored)]:[];
 if(path==='rpc/icash_arm_owner_inbound_acceptance'){if(stored)return null;stored={...run,state:'armed',provider_call_sid:null,conversation_id:null,challenge_salt:body.p_challenge_salt,challenge_hash:body.p_challenge_hash};return stored;}
 if(path==='rpc/icash_attempt_owner_inbound_acceptance'){if(stored?.state!=='armed')return null;stored={...stored,state:'inspecting',provider_call_sid:body.p_call_sid,conversation_id:body.p_conversation};return stored;}
 if(path==='rpc/icash_claim_owner_inbound_acceptance'){if(stored?.state!=='inspecting')return null;claimed=true;stored.state='claimed';return stored;}
 if(path==='rpc/icash_finish_owner_inbound_acceptance'){stored.state=body.p_evidence.outcome;return stored;}
 if(path==='rpc/icash_cancel_owner_inbound_acceptance'){stored.state=stored.state==='armed'?'cancelled':'needs_review';return stored;}
 throw Error(path);
};
const service=await loadService('lib/owner-inbound-acceptance-service.ts',{db,createOwnerInboundProviders:fakeProviders,...policy});
const beforeSid=process.env.TWILIO_ACCOUNT_SID;process.env.TWILIO_ACCOUNT_SID=testAccountSid;
const before=process.env.ICASH_OWNER_INBOUND_TEST_ENABLED;process.env.ICASH_OWNER_INBOUND_TEST_ENABLED='true';
try{
 const approval={configId:c.id,quoteCapCents:65,rateEvidenceHash:c.rate_evidence_hash};
 for(const unavailable of [undefined,'',testAccountSid+'\n',wrongAccountSid]){
  if(unavailable===undefined)delete process.env.TWILIO_ACCOUNT_SID;else process.env.TWILIO_ACCOUNT_SID=unavailable;
  assert.equal((await service.ownerInboundStatus(owner)).canArm,false);
  await assert.rejects(service.armOwnerInbound(owner,approval));
  assert.equal(await service.beginOwnerInbound(eventForAccount),null);
  assert.equal(calls.filter(x=>x.path.startsWith('rpc/')).length,0,'unavailable trust must not reserve or admit');
  assert.equal(providerFactories,0,'unavailable trust must not read a provider');
 }
 process.env.TWILIO_ACCOUNT_SID=testAccountSid;
 assert.equal((await service.ownerInboundStatus(owner)).canArm,true);
 await assert.rejects(service.armOwnerInbound(owner,{...approval,quoteCapCents:1}));assert.equal(calls.filter(x=>x.path.startsWith('rpc/')).length,0);
 const armed=await service.armOwnerInbound(owner,approval);assert.match(armed.challenge,/^\d{8}$/);assert.equal(stored.challenge_hash.length,64);assert(!JSON.stringify(calls).includes(armed.challenge));
 assert(!JSON.stringify(await service.ownerInboundStatus(owner)).includes(armed.challenge));
 await assert.rejects(service.armOwnerInbound(owner,approval));
 const event={caller_id:c.owner_phone,called_number:c.ingress_phone,agent_id:c.agent_id,call_sid:tw.sid,conversation_id:conv.conversation_id};
 assert.equal(await service.beginOwnerInbound({...event,caller_id:'+12145550123'}),null);
 fetchFails=true;assert.equal(await service.beginOwnerInbound(event),null);assert.equal(stored.state,'needs_review');assert.equal(claimed,false);assert.equal(await service.beginOwnerInbound(event),null);
 fetchFails=false;stored={...run,state:'armed',provider_call_sid:null,conversation_id:null};tw.status='in-progress';conv.status='in-progress';const result=await service.beginOwnerInbound(event);assert.equal(result.branch_id,c.branch_id);assert.equal(claimed,true);assert.equal(conversationReads,0,'no circular early conversation receipt dependency');assert.equal(await service.beginOwnerInbound(event),null);
 assert.equal((await service.reconcileOwnerInboundRun(owner,run.id)).status,'provider_processing');assert.equal(stored.state,'claimed');
 stored.challenge_hash=challenge.hash;stored.challenge_salt=challenge.salt;tw.status='completed';conv.status='done';assert.equal((await service.reconcileOwnerInboundRun(owner,run.id)).status,'passed');
 // Loss or mismatch of runtime trust never settles a reserved observed run.
 stored={...run,state:'claimed'};
 for(const unavailable of [undefined,'',testAccountSid+'\n',wrongAccountSid]){
  if(unavailable===undefined)delete process.env.TWILIO_ACCOUNT_SID;else process.env.TWILIO_ACCOUNT_SID=unavailable;
  const beforeProvider=providerFactories,beforeRpc=calls.filter(x=>x.path.startsWith('rpc/')).length;
  assert.equal((await service.reconcileOwnerInboundRun(owner,run.id)).status,'needs_review_no_retry');
  assert.equal(stored.state,'claimed');assert.equal(providerFactories,beforeProvider);assert.equal(calls.filter(x=>x.path.startsWith('rpc/')).length,beforeRpc);
 }
 stored={...run,state:'armed',provider_call_sid:null,conversation_id:null};delete process.env.TWILIO_ACCOUNT_SID;
 const heldStatus=await service.ownerInboundStatus(owner);assert.equal(heldStatus.canArm,false);assert.equal(heldStatus.canCancel,true);
 assert.equal((await service.cancelOwnerInbound(owner,run.id)).status,'cancelled','account outage preserves cancellation');
 process.env.TWILIO_ACCOUNT_SID=testAccountSid;
 assert(!JSON.stringify(calls).includes(challenge.code));assert(calls.filter(x=>x.path.startsWith('rpc/')).every(x=>!('transcript' in x.body)));
}finally{if(beforeSid===undefined)delete process.env.TWILIO_ACCOUNT_SID;else process.env.TWILIO_ACCOUNT_SID=beforeSid;
if(before===undefined)delete process.env.ICASH_OWNER_INBOUND_TEST_ENABLED;else process.env.ICASH_OWNER_INBOUND_TEST_ENABLED=before;}

let ownerCalls=0,signedIn=true;
const route=await loadService('app/api/owner-inbound-acceptance/route.ts',{NextResponse:{json:Response.json},z,workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return owner;},ownerInboundConfirmation:policy.ownerInboundConfirmation,ownerInboundStatus:async()=>({status:'held'}),armOwnerInbound:async()=>{ownerCalls++;return {status:'armed'};},cancelOwnerInbound:async()=>{ownerCalls++;return {status:'cancelled'};},reconcileOwnerInboundRun:async()=>{ownerCalls++;return {status:'needs_review'};}});
const req=(body,origin='https://test.invalid',contentType='application/json')=>new Request('https://test.invalid/api/owner-inbound-acceptance',{method:'POST',headers:{origin,'content-type':contentType},body:JSON.stringify(body)});
const body={action:'arm',confirmation:policy.ownerInboundConfirmation,configId:c.id,quoteCapCents:65,rateEvidenceHash:c.rate_evidence_hash};
assert.equal((await route.POST(req(body,'https://evil.invalid'))).status,403);assert.equal((await route.POST(req(body,'https://test.invalid','text/plain'))).status,415);
for(const extra of [{phone:c.owner_phone},{receipt:conv},{challenge:challenge.code},{accountId:owner.accountId}])assert.equal((await route.POST(req({...body,...extra}))).status,400);
signedIn=false;assert.equal((await route.GET()).status,401);assert.equal((await route.POST(req(body))).status,401);signedIn=true;assert.equal(ownerCalls,0);
const response=await route.POST(req(body));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(ownerCalls,1);

let admitted=0,business=0;const secret='0'.repeat(64),prevSecret=process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET,prevGlobal=process.env.ICASH_LIVE_WORK_READY;
process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET=secret;process.env.ICASH_LIVE_WORK_READY='false';process.env.ICASH_OWNER_INBOUND_TEST_ENABLED='true';
const inbound=await loadService('app/api/internal/voice/inbound/route.ts',{NextResponse:{json:Response.json},createHash,ownerInboundTarget:target,beginOwnerInbound:async()=>{admitted++;return initiation;},inboundAuthorized,inboundCallSchema,inboundCapability,inboundInitiation,db:async()=>{business++;throw Error('business held');},elevenRequest:async()=>{business++;throw Error('business held');}});
const event={caller_id:c.owner_phone,called_number:c.ingress_phone,agent_id:c.agent_id,call_sid:tw.sid,conversation_id:conv.conversation_id};
const webhook=(value=event,auth='Bearer '+secret)=>new Request('https://test.invalid/api/internal/voice/inbound',{method:'POST',headers:{authorization:auth},body:JSON.stringify(value)});
try{assert.equal((await inbound.POST(webhook(event,'wrong'))).status,401);assert.equal(admitted,0);assert.equal((await inbound.POST(webhook())).status,200);assert.equal(admitted,1);assert.equal((await inbound.POST(webhook({...event,caller_id:'+12145550123'}))).status,503);assert.equal(business,0);}
finally{for(const [key,val] of [['ELEVENLABS_INBOUND_WEBHOOK_SECRET',prevSecret],['ICASH_LIVE_WORK_READY',prevGlobal],['ICASH_OWNER_INBOUND_TEST_ENABLED',before]]){if(val===undefined)delete process.env[key];else process.env[key]=val;}}
console.log('Owner inbound policy/service/routes: private hash-only code, 3 attempts, full receipts, attempt-before-fetch, uncertain consumed, auth/CSRF and all business HOLDs pass. Synthetic only.');
