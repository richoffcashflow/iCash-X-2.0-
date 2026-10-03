// Local synthetic proof. All transport is injected; no credential/provider reads.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readRecordedReceptionReadiness,incomingReadinessTargets as targets} from '../lib/recorded-reception-readiness.ts';
import {receptionTarget,receptionGreeting,receptionPrompt} from '../lib/general-reception.ts';
import {recordedReceptionStopInstruction,recordedReceptionUrl} from '../lib/recorded-reception.ts';
import {privateHeaders} from '../lib/required-call-recording.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const now=Date.parse('2026-10-03T17:00:00Z'),key='LOCAL_SYNTHETIC_PROVIDER_KEY';
const main='agtbrch_mainfixture';
const origin='https://api.us.elevenlabs.io',prefix=origin+'/v1/convai/agents/'+targets.agentId;
const urls=[...targets.profiles.map(t=>prefix+'?branch_id='+t.branchId),prefix+'/branches?include_archived=true&limit=100',origin+'/v1/convai/settings',origin+'/v1/convai/tools/'+targets.stopToolId];
function fixtures(){
 const agents=targets.profiles.map(t=>({agent_id:targets.agentId,main_branch_id:main,branch_id:t.branchId,version_id:t.expectedVersionId,conversation_config:{agent:{first_message:receptionGreeting,prompt:{prompt:receptionPrompt+recordedReceptionStopInstruction,max_tokens:120,llm:'qwen3-30b-a3b',tools:[],tool_ids:[targets.stopToolId],mcp_server_ids:[],knowledge_base:[]}},asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:t.seconds}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false},call_limits:{agent_concurrency_limit:4,bursting_enabled:false},queueing_config:{enabled:true,wait_timeout_seconds:30},workspace_overrides:{webhooks:{events:[],post_call_webhook_id:null,send_audio:false}},overrides:{enable_conversation_initiation_client_data_from_webhook:false,conversation_config_override:{conversation:{max_duration_seconds:true}}}}}));
 const listed={results:[{id:main,agent_id:targets.agentId,current_live_percentage:100,is_archived:false,draft_exists:false},...targets.profiles.map(t=>({id:t.branchId,agent_id:targets.agentId,current_live_percentage:0,is_archived:false,draft_exists:false}))],meta:{total:3}};
 const workspace={webhooks:{post_call_webhook_id:null}};
 const tool={id:targets.stopToolId,tool_config:{type:'webhook',name:'icash_stop_reception_recording',api_schema:{url:recordedReceptionUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_reception_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_reception_recording_id'}}}}}};
 return {agents,listed,workspace,tool};
}
function transport(f,mutate){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url,options});const i=urls.indexOf(url);assert(i>=0,'No arbitrary provider URL');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);assert.equal(options.headers['xi-api-key'],key);assert(options.signal instanceof AbortSignal);const values=[...f.agents,f.listed,f.workspace,f.tool],value=values[i];return mutate?.(i,value)??new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});}};}
async function inspect(f=fixtures(),mutate){const net=transport(f,mutate),result=await readRecordedReceptionReadiness({ELEVENLABS_API_KEY:key},{...net,now:()=>now});return {result,net};}

test('fixed five GETs derive canonical hashes and safe checks without approvals or raw payloads',async()=>{
 const {result,net}=await inspect();assert.equal(net.calls.length,5);assert.equal(result.mode,'read_only');assert.equal(result.status,'checked');assert(result.stopToolMatches);assert(result.workspacePostcallAbsent);
 for(const [i,r] of result.branches.entries()){assert.equal(r.providerChecksPass,true);assert.match(r.observedConfigHash,/^[a-f0-9]{64}$/);assert.equal(r.observedVersionId,targets.profiles[i].expectedVersionId);assert.equal(r.draftExists,false);assert.equal(r.livePercentage,0);}
 const text=JSON.stringify(result);for(const secret of [key,receptionPrompt,receptionGreeting,'api.us.elevenlabs.io','request_headers','platform_settings','conversation_config','approval_reference','secret__icash_reception_stop_token','qwen3-30b-a3b'])assert(!text.includes(secret),secret);
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
 const route=await loadService('app/api/owner-reception/recorded-readiness/route.ts',{workAccount:async()=>{if(fail)throw Error('SIGN_IN_REQUIRED');return owner;},receptionTarget,privateHeaders,process:{env:{ELEVENLABS_API_KEY:key}},readRecordedReceptionReadiness:async(env,{signal})=>{calls++;assert.equal(env.ELEVENLABS_API_KEY,key);assert(signal instanceof AbortSignal);return (await inspect()).result;}});
 const request=(suffix='',headers={})=>new Request('https://www.geticashx.com/api/owner-reception/recorded-readiness'+suffix,{headers:{host:'www.geticashx.com',...headers}});
 assert.equal(route.POST,undefined);assert.equal(route.maxDuration,20);
 for(const suffix of ['?agent_id=agent_other','?branch_id=x','?tool_id=x','?url=https://foreign.invalid','?x=1'])assert.equal((await route.GET(request(suffix))).status,400);
 for(const headers of [{origin:'https://foreign.invalid'},{'sec-fetch-site':'cross-site'},{host:'foreign.invalid'}])assert([400,403].includes((await route.GET(request('',headers))).status));
 owner={...owner,userId:'wrong'};assert.equal((await route.GET(request())).status,403);owner={accountId:'wrong',userId:receptionTarget.ownerUserId};assert.equal((await route.GET(request())).status,403);fail=true;assert.equal((await route.GET(request())).status,401);assert.equal(calls,0);
 fail=false;owner={accountId:receptionTarget.accountId,userId:receptionTarget.ownerUserId};const response=await route.GET(request('',{origin:'https://www.geticashx.com','sec-fetch-site':'same-origin'}));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(calls,1);
});
test('standalone owner page is authenticated, linked, cancelable and has no activation action',()=>{
 const page=readFileSync('app/owner-reception/recorded-readiness/page.tsx','utf8'),ui=readFileSync('app/owner-reception/recorded-readiness/readiness.tsx','utf8'),home=readFileSync('app/owner-reception/page.tsx','utf8');
 assert.match(page,/await workAccount/);assert.match(page,/account\.userId===receptionTarget.ownerUserId/);assert.match(home,/\/owner-reception\/recorded-readiness/);assert.match(ui,/pending.current\?\.abort/);assert.match(ui,/if\(pending.current\)return/);assert.match(ui,/setResult\(null\)/);assert.match(ui,/role="alert"/);assert.match(ui,/observedConfigHash/);assert(!/method:'POST'|reviewToken|confirm\(/.test(ui));
});
