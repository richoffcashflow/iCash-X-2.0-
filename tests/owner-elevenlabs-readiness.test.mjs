import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readOwnerElevenLabsReadiness,OwnerElevenLabsReadinessError} from '../lib/owner-elevenlabs-readiness.ts';
import {ownerInboundTarget as target} from '../lib/owner-inbound-acceptance.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

// Synthetic only: no runtime credentials, live provider requests or account writes.
const key='SYNTHETIC_ELEVENLABS_KEY',secret='SYNTHETIC_WEBHOOK_SECRET_WITH_32_PLUS_CHARACTERS';
const env={ELEVENLABS_API_KEY:key,ELEVENLABS_INBOUND_WEBHOOK_SECRET:secret};
const privateSentinel='PRIVATE_PROVIDER_DATA_MUST_NOT_LEAVE_SERVER';
const agent={agent_id:target.agentId,branch_id:target.branchId,
 conversation_config:{agent:{prompt:{llm:'gemini-2.5-flash',max_tokens:150,prompt:privateSentinel}},conversation:{max_duration_seconds:60}},
 platform_settings:{queueing_config:{enabled:false,wait_timeout_seconds:30},call_limits:{bursting_enabled:false},privacy:{record_voice:false,retention_days:7,delete_transcript_and_pii:true,delete_audio:true,zero_retention_mode:false},auth:{enable_auth:true,shareable_token:privateSentinel},overrides:{enable_conversation_initiation_client_data_from_webhook:true},workspace_overrides:{conversation_initiation_client_data_webhook:{url:'https://private.invalid/'+privateSentinel,request_headers:{Authorization:'Bearer '+secret,'Private-Header':privateSentinel}}}},
 private:privateSentinel,
};
const branch={id:target.branchId,agent_id:target.agentId,is_archived:false,current_live_percentage:0,access_info:{creator_email:privateSentinel}};
const phone={phone_number_id:target.phoneNumberId,phone_number:target.ingressNumber,provider:'twilio',assigned_agent:{agent_id:target.agentId,branch_id:target.branchId},label:privateSentinel};
const defaultAgent={...structuredClone(agent),branch_id:'agtbrch_synthetic_main'};
const urls=[
 `https://api.us.elevenlabs.io/v1/convai/agents/${target.agentId}?branch_id=${target.branchId}`,
 `https://api.us.elevenlabs.io/v1/convai/agents/${target.agentId}/branches/${target.branchId}`,
 `https://api.us.elevenlabs.io/v1/convai/phone-numbers/${target.phoneNumberId}`,
 `https://api.us.elevenlabs.io/v1/convai/agents/${target.agentId}`,
];
function fixture(receipts=[agent,branch,phone,defaultAgent],replacement){
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push(url);assert(urls.includes(url));assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  assert.equal(options.headers['xi-api-key'],key);assert.equal(options.headers.Authorization,undefined);
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert(options.signal instanceof AbortSignal);
  return replacement?replacement(url):Response.json(receipts[urls.indexOf(url)]??defaultAgent);
 };
 return {calls,run:(injected=env)=>readOwnerElevenLabsReadiness(injected,fetcher)};
}
const happy=fixture(),result=await happy.run();assert.deepEqual(happy.calls,urls);
assert.equal(result.status,'checked');assert.equal(result.agent.model,'gemini-2.5-flash');assert.equal(result.agent.maxDurationSeconds,60);
assert.equal(result.agent.maxTokens,150);assert.equal(result.agent.maxTokensStatus,'bounded');
assert.equal(result.agent.queueEnabled,false);assert.equal(result.agent.queueWaitTimeoutSeconds,30);assert.equal(result.agent.burstingEnabled,false);
assert.equal(result.branch.liveTrafficPercent,0);assert.equal(result.phone.assignedAgentMatches,true);assert.equal(result.phone.assignedBranchMatches,true);
assert.equal(result.agent.webhookAuthentication.authorizationHeaderPresent,true);assert.equal(result.agent.webhookAuthentication.authorizationValueComparable,true);assert.equal(result.agent.webhookAuthentication.authorizationMatchesServerSecret,true);
assert.equal(result.callVerification,'not_tested');assert.equal(result.agent.webhookAuthentication.workspaceFallback,'not_read');
for(const hidden of [key,secret,privateSentinel,target.agentId,target.ownerPhone,target.ingressNumber])assert(!JSON.stringify(result).includes(hidden));
assert.deepEqual(Object.keys(result).sort(),['agent','branch','callVerification','checkedAt','incomingDefault','phone','region','status']);
assert.equal(result.agent.webhookAuthentication.scope,'private_test_branch_override_only');assert.equal(result.incomingDefault.webhookAuthentication.scope,'default_agent_override_only');assert.equal(result.incomingDefault.assignedPhoneBranchMatches,false);assert.equal(result.incomingDefault.requestAuthenticationVerified,false);
const assignedDefault={...structuredClone(phone),assigned_agent:{agent_id:target.agentId,branch_id:defaultAgent.branch_id}};
const differentDefault=structuredClone(defaultAgent);differentDefault.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook.request_headers.Authorization='Bearer '+'X'.repeat(40);
const compared=await fixture([agent,branch,assignedDefault,differentDefault]).run();assert.equal(compared.incomingDefault.assignedPhoneBranchMatches,true);assert.equal(compared.incomingDefault.webhookAuthentication.authorizationMatchesServerSecret,false);assert.equal(compared.agent.webhookAuthentication.authorizationMatchesServerSecret,true,'Private match must not certify the incoming default header');
assert.deepEqual(Object.keys(result.agent).sort(),['authenticationEnabled','burstingEnabled','initiationWebhookEnabled','maxDurationSeconds','maxTokens','maxTokensStatus','model','privacy','queueEnabled','queueWaitTimeoutSeconds','status','webhookAuthentication']);
assert.deepEqual(Object.keys(result.agent.webhookAuthentication).sort(),['authorizationBearerScheme','authorizationHeaderPresent','authorizationHeaderUnique','authorizationMatchesServerSecret','authorizationValueComparable','overrideConfigured','scope','serverWebhookSecretConfigured','webhookUrl','webhookUrlMatchesCanonical','workspaceFallback']);
assert.equal(result.agent.webhookAuthentication.webhookUrl,null);assert.equal(result.agent.webhookAuthentication.webhookUrlMatchesCanonical,false);assert.equal(result.agent.webhookAuthentication.authorizationBearerScheme,true);assert.equal(result.agent.webhookAuthentication.authorizationHeaderUnique,true);
for(const [url,canonical,shown] of [
 ['https://www.geticashx.com/api/internal/voice/inbound',true,true],
 ['https://geticashx.com/api/internal/voice/inbound',false,true],
 ['https://www.geticashx.com/api/internal/voice/inbound?private='+privateSentinel,false,false],
 [undefined,null,false],
]){const a=structuredClone(agent);a.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook.url=url;const auth=(await fixture([a,branch,phone]).run()).agent.webhookAuthentication;assert.equal(auth.webhookUrl,shown?url:null);assert.equal(auth.webhookUrlMatchesCanonical,canonical);assert(!JSON.stringify(auth).includes(privateSentinel));}
for(const [header,scheme] of [['Token '+secret,false],['bearer '+secret,false],['Bearer '+secret,true],[{secret_id:privateSentinel},null]]){const a=structuredClone(agent);a.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook.request_headers.Authorization=header;const auth=(await fixture([a,branch,phone]).run()).agent.webhookAuthentication;assert.equal(auth.authorizationBearerScheme,scheme);}
assert.deepEqual(Object.keys(result.agent.privacy).sort(),['deleteAudio','deleteTranscriptAndPii','recordVoice','retentionDays','zeroRetentionMode']);
assert.deepEqual(Object.keys(result.branch).sort(),['archived','liveTrafficPercent','status']);
assert.deepEqual(Object.keys(result.phone).sort(),['assignedAgentMatches','assignedBranchMatches','status']);

for(const header of [{secret_id:privateSentinel},'********','Bearer ********','Bearer [REDACTED]','Bearer '+'redacted'.repeat(8),'Bearer {{secret}}',null,42,'']){
 const a=structuredClone(agent);a.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook.request_headers.Authorization=header;
 const auth=(await fixture([a,branch,phone]).run()).agent.webhookAuthentication;
 assert.equal(auth.authorizationHeaderPresent,true);assert.equal(auth.authorizationValueComparable,false);assert.equal(auth.authorizationMatchesServerSecret,null);
}
for(const header of ['Bearer '+'X'.repeat(40),'Bearer '+secret]){
 const a=structuredClone(agent);a.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook.request_headers={aUtHoRiZaTiOn:header};
 const auth=(await fixture([a,branch,phone]).run()).agent.webhookAuthentication;
 assert.equal(auth.authorizationValueComparable,true);assert.equal(auth.authorizationMatchesServerSecret,header==='Bearer '+secret);
}
for(const headers of [{},{Authorization:'Bearer '+secret,authorization:'Bearer '+secret},undefined]){
 const a=structuredClone(agent);a.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook.request_headers=headers;
 const auth=(await fixture([a,branch,phone]).run()).agent.webhookAuthentication;
 assert.equal(auth.authorizationHeaderPresent,headers===undefined?null:Object.keys(headers).length>0);assert.equal(auth.authorizationMatchesServerSecret,null);
}
for(const server of [undefined,'short']){
 const auth=(await fixture().run({...env,ELEVENLABS_INBOUND_WEBHOOK_SECRET:server})).agent.webhookAuthentication;
 assert.equal(auth.authorizationHeaderPresent,true);assert.equal(auth.authorizationValueComparable,true);assert.equal(auth.serverWebhookSecretConfigured,false);assert.equal(auth.authorizationMatchesServerSecret,null);
}
const missing=await fixture([{agent_id:target.agentId,branch_id:target.branchId},{id:target.branchId,agent_id:target.agentId},{phone_number_id:target.phoneNumberId,phone_number:target.ingressNumber,provider:'twilio'}]).run();
assert.equal(missing.agent.maxTokensStatus,'not_returned');assert.equal(missing.agent.maxTokens,null);
for(const [value,status,expected] of [[-1,'unlimited',-1],[1,'bounded',1],[0,'unknown',null],[-2,'unknown',null],['150','unknown',null],[null,'unknown',null]]){
 const a=structuredClone(agent);a.conversation_config.agent.prompt.max_tokens=value;const output=await fixture([a,branch,phone]).run();assert.equal(output.agent.maxTokensStatus,status);assert.equal(output.agent.maxTokens,expected);
}
assert.equal(missing.agent.model,null);assert.equal(missing.agent.maxDurationSeconds,null);assert.equal(missing.agent.queueEnabled,null);assert.equal(missing.agent.burstingEnabled,null);assert.equal(missing.agent.authenticationEnabled,null);assert.equal(missing.branch.liveTrafficPercent,null);assert.equal(missing.phone.assignedAgentMatches,null);assert.equal(missing.agent.webhookAuthentication.overrideConfigured,null);assert.equal(missing.agent.webhookAuthentication.authorizationHeaderPresent,null);
for(const change of [
 a=>a.conversation_config.agent.prompt.llm=privateSentinel,a=>a.conversation_config.agent.prompt.llm='new-unknown-model',
 a=>a.conversation_config.conversation.max_duration_seconds='60',a=>a.platform_settings.queueing_config.enabled='false',
 a=>a.platform_settings.privacy.retention_days=-2,a=>a.platform_settings.call_limits.bursting_enabled=0,
]){const a=structuredClone(agent);change(a);const output=await fixture([a,branch,phone]).run();assert(!JSON.stringify(output).includes(privateSentinel));assert(Object.values(output.agent).includes(null)||output.agent.privacy.retentionDays===null);}
for(const index of [0,1,2]){
 const receipts=structuredClone([agent,branch,phone]);receipts[index][index===0?'branch_id':index===1?'agent_id':'phone_number']+='different';
 const output=await fixture(receipts).run();assert.equal(output.status,'partial');assert.equal(output[['agent','branch','phone'][index]].status,'target_mismatch');
 assert(!JSON.stringify(output).includes(privateSentinel));
}
const changedPhone=structuredClone(phone);changedPhone.assigned_agent={agent_id:'agent_other',branch_id:'agtbrch_other'};
const mismatch=await fixture([agent,branch,changedPhone]).run();assert.equal(mismatch.phone.assignedAgentMatches,false);assert.equal(mismatch.phone.assignedBranchMatches,false);
for(const invalid of [undefined,'',key+'\n']){const f=fixture();await assert.rejects(f.run({...env,ELEVENLABS_API_KEY:invalid}),OwnerElevenLabsReadinessError);assert.equal(f.calls.length,0);}
for(const [status,expected] of [[401,'provider_auth_failed'],[403,'provider_access_denied'],[404,'provider_unavailable'],[429,'provider_unavailable'],[500,'provider_unavailable']]){
 const f=fixture(undefined,()=>new Response(privateSentinel,{status})),output=await f.run();assert.equal(f.calls.length,4);assert.equal(output.status,'partial');assert.equal(output.agent.status,expected);assert(!JSON.stringify(output).includes(privateSentinel));
}
for(const replacement of [
 ()=>Response.json([]),()=>new Response('not json '+privateSentinel,{headers:{'content-type':'application/json'}}),
 ()=>new Response(privateSentinel,{headers:{'content-type':'text/html'}}),
 ()=>Response.json(agent,{headers:{'Content-Length':String(1024*1024+1)}}),
 ()=>new Response(' '.repeat(1024*1024+1),{headers:{'content-type':'application/json'}}),
 ()=>new Response(new ReadableStream({start(c){c.error(Error(privateSentinel));}}),{headers:{'content-type':'application/json'}}),
]){const output=await fixture(undefined,replacement).run();assert.equal(output.agent.status,'provider_receipt_invalid');assert(!JSON.stringify(output).includes(privateSentinel));}
const unavailable=await fixture(undefined,()=>{throw Error(privateSentinel);}).run();assert.equal(unavailable.agent.status,'provider_unavailable');assert(!JSON.stringify(unavailable).includes(privateSentinel));
const redirected=await fixture(undefined,()=>{const r=Response.json(agent);Object.defineProperty(r,'redirected',{value:true});return r;}).run();assert.equal(redirected.agent.status,'provider_unavailable');
const foreignUrl=await fixture(undefined,()=>{const r=Response.json(agent);Object.defineProperty(r,'url',{value:'https://other.invalid'});return r;}).run();assert.equal(foreignUrl.agent.status,'provider_unavailable');
globalThis.window={};await assert.rejects(fixture().run(),OwnerElevenLabsReadinessError);delete globalThis.window;

let reads=0,owner='owner',failure=null;
const route=await loadService('app/api/owner-inbound-acceptance/elevenlabs/route.ts',{
 NextResponse:{json:Response.json},ownerInboundTarget:target,OwnerElevenLabsReadinessError,process:{env},
 workAccount:async()=>{if(owner==='signed_out')throw Error('SIGN_IN_REQUIRED');return {accountId:owner==='foreign_account'?'foreign':target.accountId,userId:owner==='foreign_user'?'foreign':target.ownerUserId};},
 readOwnerElevenLabsReadiness:async injected=>{assert.deepEqual(injected,env);reads++;if(failure)throw failure;return result;},
});
const request=new Request('https://test.invalid/api/owner-inbound-acceptance/elevenlabs');
owner='signed_out';assert.equal((await route.GET(request)).status,401);
for(const foreign of ['foreign_account','foreign_user']){owner=foreign;assert.equal((await route.GET(request)).status,403);}
owner='owner';assert.equal((await route.GET(new Request(request.url+'?agent_id=other'))).status,400);assert.equal(reads,0);
const response=await route.GET(request);assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.equal(reads,1);
assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(route.POST,undefined);assert.equal(route.PATCH,undefined);
failure=new OwnerElevenLabsReadinessError();assert.deepEqual(await (await route.GET(request)).json(),{status:'configuration_unavailable'});
failure=Error(privateSentinel);assert.deepEqual(await (await route.GET(request)).json(),{status:'readiness_unavailable'});
const source=readFileSync('lib/owner-elevenlabs-readiness.ts','utf8');assert(!source.includes('process.env'));assert(!/console\./.test(source));assert(!source.includes('/v1/convai/secrets'));
console.log('Owner ElevenLabs metadata: pinned owner and US targets, GET-only bounded transport, explicit unknowns, allowlisted output, presence separate from comparable auth match, no live calls or mutations');
