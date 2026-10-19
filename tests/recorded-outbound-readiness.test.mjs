import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {readRecordedOutboundReadiness,recordedOutboundTarget as t} from '../lib/recorded-outbound-readiness.ts';
import {canonical,sha,privateHeaders} from '../lib/required-call-recording.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const key='SYNTHETIC_ONLY_PROVIDER_KEY',accountSid='AC'+'a'.repeat(32),now=Date.parse('2026-10-03T18:00:00Z'),origin='https://api.elevenlabs.io',p='/v1/convai/agents/'+t.agentId;
const urls=[p+'?branch_id='+t.branchId,p+'/branches?include_archived=true&limit=100','/v1/convai/settings',... [t.stopToolId,t.callbackToolId,t.handoffToolId,t.contractToolId].map(id=>'/v1/convai/tools/'+id)].map(p=>origin+p);
function fixtures(){
 const agent={agent_id:t.agentId,branch_id:t.branchId,version_id:t.versionId,main_branch_id:'agtbrch_mainfixture',phone_numbers:[],conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{prompt:'PRIVATE_PROMPT',tool_ids:[t.callbackToolId,t.handoffToolId,t.stopToolId,t.contractToolId]}}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},workspace_overrides:{webhooks:{send_audio:false}},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
 const tool=(id,role,keys,variable)=>({id,tool_config:{type:'webhook',name:role==='recording/stop'?'icash_stop_recording':'fixture',api_schema:{url:'https://www.geticashx.com/api/internal/voice/'+role,method:'POST',request_headers:{Authorization:{variable_name:variable}},request_body_schema:{type:'object',required:keys,properties:Object.fromEntries(keys.map(k=>[k,{type:'string',...(k==='recordingId'?{dynamic_variable:'icash_recording_id'}:k==='conversationId'?{dynamic_variable:'system__conversation_id'}:{})}]))}}}});
 return [agent,{results:[{id:t.branchId,agent_id:t.agentId,draft_exists:false,is_archived:false,current_live_percentage:0}],meta:{total:1}},{webhooks:{post_call_webhook_id:null}},tool(t.stopToolId,'recording/stop',['recordingId'],'secret__icash_recording_stop_token'),tool(t.callbackToolId,'callback',['conversationId','dueAt','timezone','readback','confirmation'],'secret__icash_call_token'),tool(t.handoffToolId,'handoff',['conversationId','reason'],'secret__icash_call_token'),{id:t.contractToolId,tool_config:{type:'webhook',name:'icash_text_contract',follow_redirects:false,api_schema:{url:'https://www.geticashx.com/api/internal/voice/contract-text',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_call_token'}},request_body_schema:{type:'object',required:['conversationId','agreedPriceCents'],properties:{conversationId:{type:'string',dynamic_variable:'system__conversation_id'},agreedPriceCents:{type:'number'}}}}}}];
}
async function inspect(data=fixtures(),mutate,extra={}){const calls=[];const result=await readRecordedOutboundReadiness({ELEVENLABS_API_KEY:key,TWILIO_ACCOUNT_SID:accountSid,...extra},{now:()=>now,fetcher:async(url,options)=>{const i=urls.indexOf(url);assert(i>=0);calls.push(url);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.headers['xi-api-key'],key);return mutate?.(i)??new Response(JSON.stringify(data[i]),{headers:{'Content-Type':'application/json'}});}});return {result,calls};}
const hashFor=a=>sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})));
const reviewFor=a=>({...t,enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),configHash:hashFor(a),providerAccountSid:accountSid,toolIds:[t.callbackToolId,t.handoffToolId,t.stopToolId,t.contractToolId],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:'required-audio-30d-speech-v1'});
test('saved production approval must match even when every structural check passes',async()=>{
 const f=fixtures(),a=f[0],hash=sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:null,procedures:null})));
 const review={...t,enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:new Date(now+3600000).toISOString(),configHash:hash,providerAccountSid:accountSid,toolIds:[t.callbackToolId,t.handoffToolId,t.stopToolId,t.contractToolId],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:'required-audio-30d-speech-v1'};
 const good=await inspect(f,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)});assert.equal(good.result.providerChecksPass,true);assert.equal(good.result.checks.activeReviewMatches,true);assert.equal(good.result.activeReviewConfigHash,hash);
 const stale=await inspect(f,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify({...review,configHash:'a'.repeat(64)})});assert.equal(stale.result.checks.canonicalRuntimeConfiguration,true);assert.equal(stale.result.checks.activeReviewMatches,false);assert.equal(stale.result.providerChecksPass,false);assert.equal(stale.result.activeReviewConfigHash,'a'.repeat(64));
 const invalid=await inspect(f,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:'invalid'});assert.equal(invalid.result.providerChecksPass,false);assert.equal(invalid.result.activeReviewConfigHash,null);
});
test('empty provider defaults preserve the server review hash separately from the raw observed hash',async()=>{
 const variants=[[],['subagent_config'],['subagents'],['subagent_config','subagents']];
 const variant=keys=>{const f=fixtures();for(const key of keys)f[0].conversation_config.agent[key]=key==='subagents'?[]:{agents:[],self_subagent:null};return f;};
 for(const approvedKeys of variants)for(const observedKeys of variants){
  const approved=variant(approvedKeys)[0],observed=variant(observedKeys),review=reviewFor(approved);
  const {result,calls}=await inspect(observed,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)});
  assert.equal(calls.length,7);assert.equal(result.providerChecksPass,true);assert.equal(result.checks.activeReviewMatches,true);
  assert.equal(result.activeReviewConfigHash,hashFor(approved));assert.equal(result.observedConfigHash,hashFor(observed[0]));
  if(approvedKeys!==observedKeys)assert.notEqual(result.activeReviewConfigHash,result.observedConfigHash);
  observed[0].conversation_config.agent.prompt.prompt='Unreviewed prompt';
  const changed=await inspect(observed,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)});
  assert.equal(changed.result.activeReviewConfigHash,review.configHash);assert.equal(changed.result.checks.activeReviewMatches,false);assert.equal(changed.result.providerChecksPass,false);
 }
});
test('only a parsed active server review supplies the approved hash, never provider fields',async()=>{
 const f=fixtures(),review=reviewFor(f[0]);f[0].activeReviewConfigHash='f'.repeat(64);f[0].configHash='e'.repeat(64);
 for(const raw of [undefined,'invalid','null',JSON.stringify({...review,enabled:false}),JSON.stringify({...review,reviewedUntil:new Date(now).toISOString()}),JSON.stringify({...review,configHash:'not-a-hash'}),JSON.stringify({configHash:review.configHash})]){
  const {result}=await inspect(f,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:raw});assert.equal(result.activeReviewConfigHash,null);
  if(raw!==undefined){assert.equal(result.checks.activeReviewMatches,false);assert.equal(result.providerChecksPass,false);}
 }
 const {result}=await inspect(f,undefined,{RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify({...review,privateExtra:'DO_NOT_RETURN_REVIEW'})});
 assert.equal(result.activeReviewConfigHash,review.configHash);assert.equal(result.checks.activeReviewMatches,true);
 for(const secret of ['DO_NOT_RETURN_REVIEW',key,accountSid,'reviewedAt','reviewedUntil','providerAccountSid','fromPhone','toolIds'])assert(!JSON.stringify(result).includes(secret),secret);
 const unavailable=await readRecordedOutboundReadiness({RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)},{now:()=>now,fetcher:()=>{throw Error('NO_PROVIDER_REQUEST');}});
 assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.activeReviewConfigHash,review.configHash);assert.equal(unavailable.observedConfigHash,null);assert.equal(unavailable.checks.activeReviewMatches,false);assert.equal(unavailable.providerChecksPass,false);
 const partial=await inspect(f,i=>i===0?new Response('unavailable',{status:503}):undefined,{RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review)});
 assert.equal(partial.result.status,'partial');assert.equal(partial.result.activeReviewConfigHash,review.configHash);assert.equal(partial.result.observedConfigHash,null);assert.equal(partial.result.checks.activeReviewMatches,false);assert.equal(partial.result.providerChecksPass,false);
});
test('seven fixed reads return exact canonical hash without review, prompt or secret material',async()=>{
 const f=fixtures(),{result,calls}=await inspect(f);assert.equal(calls.length,7);assert.equal(result.status,'checked');assert.equal(result.providerChecksPass,true);assert.equal(result.mode,'read_only');
 const a=f[0];assert.equal(result.observedConfigHash,sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:null,procedures:null}))));
 assert.equal(result.activeReviewConfigHash,null);
 for(const text of ['PRIVATE_PROMPT',key,accountSid,'secret__','request_headers','reviewedAt','reviewedUntil','enabled'])assert(!JSON.stringify(result).includes(text),text);
});
test('drift, wrong branch/version, tool substitution, assignments and partial evidence fail closed',async()=>{
 const changes=[f=>f[0].version_id='agtvrsn_other',f=>f[0].branch_id='agtbrch_other',f=>f[0].conversation_config.conversation.max_duration_seconds=60,f=>f[0].platform_settings.privacy.record_voice=true,f=>f[0].platform_settings.call_limits.bursting_enabled=true,f=>f[0].conversation_config.agent.prompt.tool_ids.push('tool_extra'),f=>f[0].phone_numbers.push({secret:'unreturned'}),f=>f[1].results[0].draft_exists=true,f=>f[1].results[0].current_live_percentage=1,f=>f[1].meta.total=2,f=>f[1].results.push({...f[1].results[0]}),f=>f[3].tool_config.api_schema.request_headers.Authorization={secret_id:'DO_NOT_EXPOSE'},f=>f[4].tool_config.api_schema.url='https://foreign.invalid',f=>f[4].tool_config.api_schema.request_headers.Extra='secret',f=>f[2].webhooks.post_call_webhook_id='hook'];
 for(const mutate of changes){const f=fixtures();mutate(f);const {result}=await inspect(f);assert.equal(result.providerChecksPass,false);assert(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));}
 const {result}=await inspect(fixtures(),i=>i===0?new Response('hidden-provider-failure',{status:403}):undefined);assert.equal(result.status,'partial');assert.equal(result.observedConfigHash,null);assert.equal(result.providerChecksPass,false);assert(!JSON.stringify(result).includes('hidden-provider-failure'));
});
test('missing credentials, non-JSON and oversized payloads reveal no data',async()=>{
 const r=await readRecordedOutboundReadiness({},{fetcher:()=>{throw Error('NO_READ');},now:()=>now});assert.equal(r.status,'unavailable');assert.equal(r.providerChecksPass,false);
 for(const response of [()=>new Response('private HTML',{headers:{'Content-Type':'text/html'}}),()=>new Response(JSON.stringify({private:'x'.repeat(300000)}),{headers:{'Content-Type':'application/json'}})]){const {result}=await inspect(fixtures(),i=>i===0?response():undefined);assert.equal(result.observedConfigHash,null);assert.equal(result.providerChecksPass,false);}
});
test('owner-only route rejects caller parameters, foreign origins and nonowners before reads',async()=>{
 const ownerInboundTarget={accountId:'owner-account',ownerUserId:'owner-user'};let owner={accountId:'owner-account',userId:'owner-user'},count=0,fail=false;
 const route=await loadService('app/api/owner-recording-test/production-readiness/route.ts',{workAccount:async()=>{if(fail)throw Error('SIGN_IN_REQUIRED');return owner;},ownerInboundTarget,privateHeaders,process:{env:{ELEVENLABS_API_KEY:key,TWILIO_ACCOUNT_SID:accountSid,RECORDED_OUTBOUND_REVIEW_JSON:'server-owned-active-review'}},readRecordedOutboundReadiness:async env=>{assert.equal(env.RECORDED_OUTBOUND_REVIEW_JSON,'server-owned-active-review');count++;return (await inspect()).result;}});
 const req=(suffix='',headers={})=>new Request('https://www.geticashx.com/api/owner-recording-test/production-readiness'+suffix,{headers:{host:'www.geticashx.com',...headers}});assert.equal(route.POST,undefined);
 assert.equal((await route.GET(req('?agent_id=other'))).status,400);assert.equal((await route.GET(req('',{origin:'https://foreign.invalid'}))).status,403);assert.equal((await route.GET(req('',{'sec-fetch-site':'cross-site'}))).status,403);assert.equal((await route.GET(req('',{host:'foreign.invalid'}))).status,400);
 owner={accountId:'other',userId:'owner-user'};assert.equal((await route.GET(req())).status,403);owner={accountId:'owner-account',userId:'other'};assert.equal((await route.GET(req())).status,403);fail=true;assert.equal((await route.GET(req())).status,401);assert.equal(count,0);
 fail=false;owner={accountId:'owner-account',userId:'owner-user'};const response=await route.GET(req());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(count,1);
});
test('owner page inspection is manual, cancellable, GET-only and has no approval action',()=>{const ui=readFileSync('app/owner-recording-test/production-readiness.tsx','utf8'),parent=readFileSync('app/owner-recording-test/check.tsx','utf8');assert(parent.includes('<ProductionRecordingReadiness/>'));assert(ui.includes('pending.current?.abort()'));assert(ui.includes('if(pending.current)return'));assert(ui.includes("method:'GET'"));assert(!/method:'POST'|reviewToken|confirm\(/.test(ui));});

test('production read-only UI renders its manual action without a call or activation control',()=>{const source=readFileSync('app/owner-recording-test/production-readiness.tsx','utf8'),require=createRequire(import.meta.url),mod={exports:{}};new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText)(require,mod,mod.exports);const html=renderToStaticMarkup(require('react').createElement(mod.exports.default));assert(html.includes('Inspect production branch (read-only)'));assert(!html.includes('Start one phone check'));assert(!html.includes('type="checkbox"'));});

test('provider account binding comes only from existing server configuration and is never returned',async()=>{for(const account of [undefined,null,'wrong','ACshort']){const result=await readRecordedOutboundReadiness({TWILIO_ACCOUNT_SID:account},{now:()=>now,fetcher:()=>{throw Error('NO_PROVIDER_KEY');}});assert.equal(result.checks.providerAccountConfigured,false);assert.equal(result.providerChecksPass,false);}const source=readFileSync('lib/recorded-outbound-readiness.ts','utf8');assert(!/AC[0-9a-fA-F]{32}/.test(source));assert(source.includes('providerAccountSid:env.TWILIO_ACCOUNT_SID'));});
