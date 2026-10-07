import {buyerReceptionGreeting,buyerReceptionPrompt} from '../lib/buyer-reception-context.ts';
// Local synthetic proof. All transport is injected; no credential/provider reads.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readRecordedReceptionReadiness,readRecordedReceptionPhoneReadiness,incomingReadinessTargets as targets} from '../lib/recorded-reception-readiness.ts';
import {receptionTarget,receptionGreeting,receptionPrompt} from '../lib/general-reception.ts';
import {recordedReceptionStopInstruction,recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {privateHeaders} from '../lib/required-call-recording.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const now=Date.parse('2026-10-03T17:00:00Z'),key='LOCAL_SYNTHETIC_PROVIDER_KEY';
const main='agtbrch_mainfixture';
const carrierToken='LOCAL_SYNTHETIC_CARRIER_TOKEN';
const accountSidFixture='AC'+'a'.repeat(32);
const env={ELEVENLABS_API_KEY:key,TWILIO_ACCOUNT_SID:accountSidFixture,TWILIO_AUTH_TOKEN:carrierToken};
const phoneUrl='https://api.twilio.com/2010-04-01/Accounts/'+accountSidFixture+'/IncomingPhoneNumbers.json?PhoneNumber='+encodeURIComponent(receptionTarget.calledNumber)+'&PageSize=2';
const origin='https://api.us.elevenlabs.io',prefix=origin+'/v1/convai/agents/'+targets.agentId;
const urls=[...targets.profiles.map(t=>prefix+'?branch_id='+t.branchId),prefix+'/branches?include_archived=true&limit=100',origin+'/v1/convai/settings',origin+'/v1/convai/tools/'+targets.stopToolId,phoneUrl];
function fixtures(){
 const agents=targets.profiles.map(t=>({agent_id:targets.agentId,main_branch_id:main,branch_id:t.branchId,version_id:t.expectedVersionId,conversation_config:{agent:{first_message:t.profile==='normal'?buyerReceptionGreeting:receptionGreeting,prompt:{prompt:(t.profile==='normal'?buyerReceptionPrompt:receptionPrompt)+recordedReceptionStopInstruction,max_tokens:120,llm:'qwen3-30b-a3b',tools:[],tool_ids:[targets.stopToolId],mcp_server_ids:[],knowledge_base:[]}},asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:t.seconds}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false},call_limits:{agent_concurrency_limit:4,bursting_enabled:false},queueing_config:{enabled:true,wait_timeout_seconds:30},workspace_overrides:{webhooks:{events:[],post_call_webhook_id:null,send_audio:false}},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true}}}}}));
 const listed={results:[{id:main,agent_id:targets.agentId,current_live_percentage:100,is_archived:false,draft_exists:false},...targets.profiles.map(t=>({id:t.branchId,agent_id:targets.agentId,current_live_percentage:0,is_archived:false,draft_exists:false}))],meta:{total:3}};
 const workspace={webhooks:{post_call_webhook_id:null}};
 const tool={id:targets.stopToolId,tool_config:{type:'webhook',name:'icash_stop_reception_recording',api_schema:{url:recordedReceptionUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}};
 const phone={incoming_phone_numbers:[{sid:'PN'+'a'.repeat(32),phone_number:receptionTarget.calledNumber,account_sid:accountSidFixture,capabilities:{voice:true},voice_url:'https://www.geticashx.com/api/reception/inbound',voice_method:'POST',voice_fallback_url:null,voice_fallback_method:'POST',voice_application_sid:null,trunk_sid:null}],next_page_uri:null};
 return {agents,listed,workspace,tool,phone};
}
function transport(f,mutate){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url,options});const i=urls.indexOf(url);assert(i>=0,'No arbitrary provider URL');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);if(i<5)assert.equal(options.headers['xi-api-key'],key);else{assert.equal(options.headers.Authorization,'Basic '+Buffer.from(accountSidFixture+':'+carrierToken).toString('base64'));assert.equal(options.headers['xi-api-key'],undefined);}assert(options.signal instanceof AbortSignal);const values=[...f.agents,f.listed,f.workspace,f.tool,f.phone],value=values[i];return mutate?.(i,value)??new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});}};}
async function inspect(f=fixtures(),mutate){const net=transport(f,mutate),result=await readRecordedReceptionReadiness(env,{...net,now:()=>now});return {result,net};}

test('fixed six GETs derive canonical hashes and safe checks without approvals or raw payloads',async()=>{
 const {result,net}=await inspect();assert.equal(net.calls.length,6);assert.equal(result.mode,'read_only');assert.equal(result.status,'checked');assert(result.stopToolMatches);assert(result.workspacePostcallAbsent);
 for(const [i,r] of result.branches.entries()){assert.equal(r.providerChecksPass,true);assert.match(r.observedConfigHash,/^[a-f0-9]{64}$/);assert.equal(r.observedVersionId,targets.profiles[i].expectedVersionId);assert.equal(r.draftExists,false);assert.equal(r.livePercentage,0);}
 const text=JSON.stringify(result);for(const secret of [key,carrierToken,accountSidFixture,receptionTarget.calledNumber,receptionPrompt,receptionGreeting,'api.us.elevenlabs.io','request_headers','platform_settings','conversation_config','approval_reference','secret__icash_reception_stop_token','qwen3-30b-a3b'])assert(!text.includes(secret),secret);
 assert.equal((await inspect()).result.branches[0].observedConfigHash,result.branches[0].observedConfigHash);
});
test('a canonical draft, unexpected version, traffic move or unsafe settings cannot be reported as pass',async()=>{
 const changes=[f=>f.listed.results[2].draft_exists=true,f=>delete f.listed.results[2].draft_exists,f=>f.agents[1].version_id='agtvrsn_changedfixture',f=>f.listed.results[2].current_live_percentage=1,f=>f.listed.results[0].current_live_percentage=99,f=>f.agents[1].platform_settings.privacy.record_voice=true,f=>f.agents[1].platform_settings.queueing_config.wait_timeout_seconds=31,f=>f.agents[1].platform_settings.call_limits.bursting_enabled=true,f=>f.agents[1].conversation_config.agent.prompt.max_tokens=151,f=>f.agents[1].conversation_config.agent.prompt.tool_ids.push('tool_extra'),f=>f.agents[1].conversation_config.conversation.max_duration_seconds=60,f=>f.agents[1].conversation_config.agent.prompt.prompt+=' external instruction'];
 for(const change of changes){const f=fixtures();change(f);const {result}=await inspect(f);assert.equal(result.branches[1].providerChecksPass,false);}
 const f=fixtures();f.listed.results[2].draft_exists=true;const {result}=await inspect(f);assert.equal(result.branches[1].draftExists,true);assert.equal(result.branches[0].providerChecksPass,true);assert.match(result.branches[1].observedConfigHash,/^[a-f0-9]{64}$/);
});
test('foreign identities, missing/duplicate/truncated branch lists and unsupported tool auth fail closed',async()=>{
 const changes=[f=>f.agents[1].agent_id='agent_foreign',f=>f.agents[1].branch_id=targets.profiles[0].branchId,f=>delete f.agents[1].platform_settings,f=>f.listed.results.push({...f.listed.results[2]}),f=>f.listed.meta.total=99,f=>f.listed.next_cursor='another-page',f=>f.tool.tool_config.api_schema.request_headers.Authorization={secret_id:'provider-private-secret'},f=>f.tool.tool_config.api_schema.url='https://foreign.invalid/stop',f=>f.workspace.webhooks.post_call_webhook_id='private-hook'];
 for(const change of changes){const f=fixtures();change(f);const {result}=await inspect(f);assert.equal(result.branches[1].providerChecksPass,false);assert(!JSON.stringify(result).includes('provider-private-secret'));}
});
test('provider access errors, malformed/oversized bodies and partial failures are redacted',async()=>{
 for(const response of [()=>new Response('private-provider-body',{status:403}),()=>new Response('not JSON',{headers:{'Content-Type':'application/json'}}),()=>new Response(JSON.stringify({secret:'x'.repeat(300000)}),{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'text/html'}})]){
  const {result}=await inspect(fixtures(),i=>i===1?response():undefined);assert.equal(result.status,'partial');assert.equal(result.branches[1].providerChecksPass,false);assert.equal(result.branches[1].observedConfigHash,null);assert.equal(result.branches[0].providerChecksPass,true);assert(!JSON.stringify(result).includes('private-provider-body'));
 }
 const r=await readRecordedReceptionReadiness({},{fetcher:()=>{throw Error('MUST_NOT_READ');},now:()=>now});assert.equal(r.status,'unavailable');assert(r.branches.every(b=>!b.providerChecksPass&&b.observedConfigHash===null));
});
test('hash is derived from actual provider snapshot and changes with a safe voice/model configuration change',async()=>{
 const first=(await inspect()).result;const f=fixtures();f.agents[0].conversation_config.tts.voice_id='voiceFixture';const second=(await inspect(f)).result;assert.notEqual(first.branches[0].observedConfigHash,second.branches[0].observedConfigHash);assert.equal(first.branches[1].observedConfigHash,second.branches[1].observedConfigHash);
});

test('owner endpoint rejects nonowners, unsafe origins and every parameter before provider reads',async()=>{
 let owner={accountId:receptionTarget.accountId,userId:receptionTarget.ownerUserId},calls=0,fail=false;
 const route=await loadService('app/api/owner-reception/recorded-readiness/route.ts',{workAccount:async()=>{if(fail)throw Error('SIGN_IN_REQUIRED');return owner;},receptionTarget,privateHeaders,process:{env},readRecordedReceptionReadiness:async(env,{signal})=>{calls++;assert.equal(env.ELEVENLABS_API_KEY,key);assert(signal instanceof AbortSignal);return (await inspect()).result;}});
 const request=(suffix='',headers={})=>new Request('https://www.geticashx.com/api/owner-reception/recorded-readiness'+suffix,{headers:{host:'www.geticashx.com',...headers}});
 assert.equal(route.POST,undefined);assert.equal(route.maxDuration,20);
 for(const suffix of ['?agent_id=agent_other','?branch_id=x','?tool_id=x','?url=https://foreign.invalid','?x=1'])assert.equal((await route.GET(request(suffix))).status,400);
 for(const headers of [{origin:'https://foreign.invalid'},{'sec-fetch-site':'cross-site'},{host:'foreign.invalid'}])assert([400,403].includes((await route.GET(request('',headers))).status));
 owner={...owner,userId:'wrong'};assert.equal((await route.GET(request())).status,403);owner={accountId:'wrong',userId:receptionTarget.ownerUserId};assert.equal((await route.GET(request())).status,403);fail=true;assert.equal((await route.GET(request())).status,401);assert.equal(calls,0);
 fail=false;owner={accountId:receptionTarget.accountId,userId:receptionTarget.ownerUserId};const response=await route.GET(request('',{origin:'https://www.geticashx.com','sec-fetch-site':'same-origin'}));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(calls,1);
});
test('standalone page is an inert linked client shell; authenticated reads are cancelable and have no activation action',()=>{
 const page=readFileSync('app/owner-reception/recorded-readiness/page.tsx','utf8'),ui=readFileSync('app/owner-reception/recorded-readiness/readiness.tsx','utf8'),home=readFileSync('app/owner-reception/page.tsx','utf8');
 assert(!/workAccount|currentUser|Sign in/.test(page));assert.match(page,/<RecordedIncomingReadiness\/>/);assert.match(home,/\/owner-reception\/recorded-readiness/);assert.match(ui,/pending.current\?\.abort/);assert.match(ui,/if\(pending.current\)return/);assert.match(ui,/setResult\(null\)/);assert.match(ui,/role="alert"/);assert.match(ui,/observedConfigHash/);assert(!/method:'POST'|reviewToken|confirm\(/.test(ui));
});

test('canonical inline stop is allowed only with the independently checked identical definition; full source remains fingerprinted',async()=>{
 const f=fixtures(),stop=structuredClone(f.tool.tool_config),end={type:'system',name:'end_call',params:{system_tool_type:'end_call'}};
 f.agents[0].conversation_config.agent.prompt.tools=[stop,end];
 const raw=structuredClone(f.agents[0]);
 const result=(await inspect(f)).result.branches[0];
 assert.equal(result.providerChecksPass,true);assert.equal(result.checks.safeInlineTools,true);assert.equal(result.checks.noTools,true);
 assert.equal(result.inlineTools.reviewedStopDefinition,true);assert.equal(result.inlineTools.matchingStopCount,1);assert.equal(result.inlineTools.nativeEndCallCount,1);assert.equal(result.inlineTools.unrecognizedCount,0);
 assert.deepEqual(f.agents[0],raw,'inspection never mutates canonical data');
 assert.notEqual(result.observedConfigHash,(await inspect()).result.branches[0].observedConfigHash,'inline tools remain covered by the original fingerprint');
 const reordered=Object.fromEntries(Object.entries(stop).reverse());f.agents[0].conversation_config.agent.prompt.tools=[reordered,end];
 assert.equal((await inspect(f)).result.branches[0].observedConfigHash,result.observedConfigHash);assert.equal((await inspect(f)).result.branches[0].providerChecksPass,true);
 const failed=(await inspect(f,i=>i===4?new Response('unavailable',{status:503}):undefined)).result.branches[0];
 assert.equal(failed.providerChecksPass,false);assert.equal(failed.checks.safeInlineTools,false);assert.equal(failed.inlineTools.matchingStopCount,0);
});
test('inline resemblance, extra fields, duplicate definitions, unsupported wrappers and unknown tools fail closed',async()=>{
 const mutations=[
  f=>f.agents[0].conversation_config.agent.prompt.tools[0].description='different description',
  f=>f.agents[0].conversation_config.agent.prompt.tools[0].api_schema.method='GET',
  f=>f.agents[0].conversation_config.agent.prompt.tools[0].api_schema.url='https://foreign.invalid/stop',
  f=>f.agents[0].conversation_config.agent.prompt.tools[0].api_schema.request_headers.Authorization={variable_name:'other'},
  f=>f.agents[0].conversation_config.agent.prompt.tools[0].api_schema.request_body_schema.properties.recordingId.dynamic_variable='other',
  f=>f.agents[0].conversation_config.agent.prompt.tools[0].execution_mode='unknown-execution',
  f=>f.agents[0].conversation_config.agent.prompt.tools.push(structuredClone(f.tool.tool_config)),
  f=>f.agents[0].conversation_config.agent.prompt.tools.push({type:'webhook',name:'unreviewed'}),
  f=>f.agents[0].conversation_config.agent.prompt.tools.push({type:'system',name:'transfer_to_number',params:{system_tool_type:'transfer_to_number'}}),
  f=>f.agents[0].conversation_config.agent.prompt.tools=[{tool_config:structuredClone(f.tool.tool_config),id:f.tool.id}],
  f=>f.agents[0].conversation_config.agent.prompt.tools='not a list',
  f=>f.agents[0].conversation_config.agent.prompt.tools={},
  f=>f.agents[0].conversation_config.agent.prompt.tool_ids=['tool_foreign'],
  f=>f.tool.id='tool_foreign',
  f=>{f.tool.tool_config.api_schema.request_headers.Extra='unapproved';f.agents[0].conversation_config.agent.prompt.tools=[structuredClone(f.tool.tool_config)];},
  f=>{f.tool.tool_config.api_schema.auth_connection={secret_id:'PRIVATE_SECRET'};f.agents[0].conversation_config.agent.prompt.tools=[structuredClone(f.tool.tool_config)];},
  f=>f.tool.response_mocks=[{response:'fake success'}],
 ];
 for(const mutate of mutations){const f=fixtures();f.agents[0].conversation_config.agent.prompt.tools=[structuredClone(f.tool.tool_config)];mutate(f);assert.equal((await inspect(f)).result.branches[0].providerChecksPass,false,mutate.toString());}
});
test('inline diagnostics are fixed, bounded, redacted classifications rather than arbitrary provider fields',async()=>{
 const f=fixtures(),sentinel='DO_NOT_RETURN_PROVIDER_SECRET';
 f.agents[0].conversation_config.agent.prompt.tools=Array.from({length:10},()=>({type:sentinel,name:sentinel,[sentinel]:sentinel,api_schema:{url:'https://'+sentinel,request_headers:{Authorization:sentinel}}}));
 const result=(await inspect(f)).result,b=result.branches[0];
 assert.equal(b.providerChecksPass,false);assert.equal(b.inlineTools.bounded,false);assert.equal(b.inlineTools.count,10);assert.equal(b.inlineTools.entries.length,8);assert.equal(b.inlineTools.unrecognizedCount,8);assert(!JSON.stringify(result).includes(sentinel));
 for(const entry of b.inlineTools.entries)assert.deepEqual(Object.keys(entry).sort(),['definitionMatches','kind','stopNameMatches','type','wrappedDefinitionPresent']);
 const service=readFileSync('lib/recorded-reception-service.ts','utf8');assert.match(service,/inspectRecordedReceptionAgent\(c,agent,found\[0\],receptionWorkspacePostcallAbsent\(workspace\),tool\)\.safe/);
 const ui=readFileSync('app/owner-reception/recorded-readiness/readiness.tsx','utf8');assert.match(ui,/Inline tool evidence/);assert.match(ui,/validInline\(b.inlineTools\)/);
});

test('current fixed incoming phone is proven from canonical carrier data without historical config',async()=>{
 const {result,net}=await inspect();assert.equal(net.calls.filter(c=>c.url===phoneUrl).length,1);assert.equal(result.phone.status,'checked');assert.equal(result.phone.bindingVerified,true);assert.equal(result.phone.route,'legacy_reception');assert(Object.values(result.phone.checks).every(Boolean));
 const body=JSON.stringify(result.phone);for(const raw of [accountSidFixture,receptionTarget.calledNumber,'PN'+'a'.repeat(32),phoneUrl,carrierToken,'Basic '])assert(!body.includes(raw));
});
test('route output is only a fixed classification and cannot mistake an override or GET for the recorded POST route',async()=>{
 for(const [url,method,app,trunk,expected] of [
  [recordedReceptionUrl+'/inbound','POST',null,null,'recorded_reception'],
  ['https://private.invalid/contains-private-data','POST',null,null,'other'],
  [recordedReceptionUrl+'/inbound','GET',null,null,'other'],
  [recordedReceptionUrl+'/inbound','POST','APprivate',null,'other'],
  [recordedReceptionUrl+'/inbound','POST',null,'TKprivate','other'],
 ]){const f=fixtures();Object.assign(f.phone.incoming_phone_numbers[0],{voice_url:url,voice_method:method,voice_application_sid:app,trunk_sid:trunk});const p=(await inspect(f)).result.phone;assert.equal(p.bindingVerified,true);assert.equal(p.route,expected);assert(!JSON.stringify(p).includes('private'));}
});
test('carrier identity, ambiguous list, pagination, capabilities and route-shape defects remain unverified',async()=>{
 const changes=[
  f=>f.phone.incoming_phone_numbers=[],f=>f.phone.incoming_phone_numbers.push(structuredClone(f.phone.incoming_phone_numbers[0])),f=>delete f.phone.next_page_uri,f=>f.phone.next_page_uri='private-next-page',
  f=>f.phone.incoming_phone_numbers[0].phone_number='+12125550199',f=>f.phone.incoming_phone_numbers[0].account_sid='AC'+'f'.repeat(32),f=>f.phone.incoming_phone_numbers[0].sid='not a phone sid',f=>f.phone.incoming_phone_numbers[0].capabilities.voice=false,
  f=>f.phone.incoming_phone_numbers[0].voice_url={secret:'private'},f=>delete f.phone.incoming_phone_numbers[0].voice_fallback_url,f=>f.phone.incoming_phone_numbers[0].voice_method='PATCH',f=>f.phone.incoming_phone_numbers[0].voice_fallback_method='DELETE',f=>f.phone.incoming_phone_numbers[0].voice_method=['POST'],f=>f.phone.incoming_phone_numbers[0].voice_fallback_method=['GET'],f=>f.phone.incoming_phone_numbers[0].voice_method={value:'POST'},f=>f.phone.incoming_phone_numbers[0].voice_fallback_method={value:'GET'},
 ];
 for(const change of changes){const f=fixtures();change(f);const r=(await inspect(f)).result;assert.equal(r.phone.bindingVerified,false,change.toString());assert.equal(r.phone.route,'unknown');assert(r.branches.every(b=>b.providerChecksPass),'carrier defect does not invent branch failure or mutate agent evidence');}
});
test('missing or malformed carrier configuration never causes an external request',async()=>{
 for(const config of [{},{TWILIO_ACCOUNT_SID:accountSidFixture},{...env,TWILIO_AUTH_TOKEN:'short'},{...env,TWILIO_ACCOUNT_SID:'not-a-valid-account'}]){
  const p=await readRecordedReceptionPhoneReadiness(config,{fetcher:()=>{throw Error('MUST_NOT_READ');}});assert.equal(p.status,'unavailable');assert.equal(p.bindingVerified,false);assert.equal(p.route,'unknown');
 }
});
test('carrier errors, redirect, foreign response URL and oversized bodies are redacted and do not discard agent observations',async()=>{
 const bad=[()=>new Response('PRIVATE_CARRIER_ERROR',{status:403}),()=>new Response('{}',{status:302,headers:{location:'https://private.invalid'}}),()=>new Response('bad json',{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response(JSON.stringify({private:'x'.repeat(66000)}),{headers:{'content-type':'application/json'}}),()=>{const r=new Response('{}',{headers:{'content-type':'application/json'}});Object.defineProperty(r,'url',{value:'https://private.invalid'});return r;},()=>{throw Error('PRIVATE_CARRIER_ERROR');}];
 for(const response of bad){const r=(await inspect(fixtures(),i=>i===5?response():undefined)).result;assert.equal(r.status,'partial');assert.equal(r.phone.status,'unavailable');assert.equal(r.phone.bindingVerified,false);assert(r.branches.every(b=>b.providerChecksPass));assert(!JSON.stringify(r).includes('PRIVATE_CARRIER_ERROR'));assert(!JSON.stringify(r).includes('private.invalid'));}
});

test('expired access with valid refresh session is authenticated and cookies saved in the guarded API, never SSR',async()=>{
 const jar=new Map([['icash_access','EXPIRED_SYNTHETIC_ACCESS'],['icash_refresh','SYNTHETIC_REFRESH']]),writes=[],authCalls=[];let providerReads=0;
 const auth=await loadService('lib/account-auth.ts',{
  cookies:async()=>({get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name,value,options)=>{writes.push({name,options});jar.set(name,value);},delete:name=>jar.delete(name)}),
  db:async()=>{throw Error('UNEXPECTED_AUTH_DB');},accountMode:()=>null,
  process:{env:{SUPABASE_URL:'https://synthetic-auth.invalid',SUPABASE_SECRET_KEY:'SYNTHETIC_AUTH_KEY'}},
  fetch:async(url,options)=>{authCalls.push({url,method:options.method});assert.equal(options.headers.apikey,'SYNTHETIC_AUTH_KEY');
   if(url==='https://synthetic-auth.invalid/auth/v1/user'){assert.equal(options.headers.Authorization,'Bearer EXPIRED_SYNTHETIC_ACCESS');return new Response('{}',{status:401});}
   assert.equal(url,'https://synthetic-auth.invalid/auth/v1/token?grant_type=refresh_token');assert.deepEqual(JSON.parse(options.body),{refresh_token:'SYNTHETIC_REFRESH'});
   return Response.json({access_token:'REFRESHED_SYNTHETIC_ACCESS',refresh_token:'ROTATED_SYNTHETIC_REFRESH',expires_in:3600,user:{id:receptionTarget.ownerUserId,email_confirmed_at:'2026-01-01T00:00:00Z'}});
  },
 });
 const account=await loadService('lib/work-account.ts',{currentUser:auth.currentUser,db:async path=>{assert.equal(path,'icash_accounts?owner_user_id=eq.'+receptionTarget.ownerUserId+'&select=id,billing_model&limit=2');return [{id:receptionTarget.accountId}];}});
 const route=await loadService('app/api/owner-reception/recorded-readiness/route.ts',{workAccount:account.workAccount,receptionTarget,privateHeaders,process:{env},readRecordedReceptionReadiness:async()=>{providerReads++;assert.equal(writes.length,2);assert.equal(jar.get('icash_access'),'REFRESHED_SYNTHETIC_ACCESS');return (await inspect()).result;}});
 const request=()=>new Request('https://www.geticashx.com/api/owner-reception/recorded-readiness',{headers:{host:'www.geticashx.com','sec-fetch-site':'same-origin'}});
 const response=await route.GET(request());assert.equal(response.status,200);assert.equal(providerReads,1);assert.equal(authCalls.length,2);assert(writes.every(w=>w.options.httpOnly&&w.options.secure));
 const body=await response.text();for(const secret of ['EXPIRED_SYNTHETIC_ACCESS','SYNTHETIC_REFRESH','REFRESHED_SYNTHETIC_ACCESS','ROTATED_SYNTHETIC_REFRESH','SYNTHETIC_AUTH_KEY'])assert(!body.includes(secret));
 jar.clear();assert.equal((await route.GET(request())).status,401);assert.equal(providerReads,1,'unauthenticated requests still cannot read any provider data');
 const page=readFileSync('app/owner-reception/recorded-readiness/page.tsx','utf8'),ui=readFileSync('app/owner-reception/recorded-readiness/readiness.tsx','utf8');
 assert(!/workAccount|currentUser|fetch\(|await/.test(page));assert.match(page,/<RecordedIncomingReadiness\/>/);assert.match(ui,/response.status===401\|\|response.status===403/);assert.match(ui,/Provider checks are unavailable\. Please retry\./);
});

test('phone proof uses only the configured server account and requires exact canonical response equality',async()=>{
 const configured='AC'+'b'.repeat(32),f=fixtures();f.phone.incoming_phone_numbers[0].account_sid=configured;
 const read=async receipt=>readRecordedReceptionPhoneReadiness({...env,TWILIO_ACCOUNT_SID:configured},{fetcher:async(url,options)=>{
  assert.equal(url,'https://api.twilio.com/2010-04-01/Accounts/'+configured+'/IncomingPhoneNumbers.json?PhoneNumber='+encodeURIComponent(receptionTarget.calledNumber)+'&PageSize=2');
  assert.equal(options.headers.Authorization,'Basic '+Buffer.from(configured+':'+carrierToken).toString('base64'));
  return Response.json(receipt);
 }});
 const verified=await read(f.phone);assert.equal(verified.bindingVerified,true);assert(!JSON.stringify(verified).includes(configured));
 f.phone.incoming_phone_numbers[0].account_sid=accountSidFixture;
 const foreign=await read(f.phone);assert.equal(foreign.bindingVerified,false);assert.equal(foreign.checks.accountMatches,false);assert.equal(foreign.route,'unknown');
});
