import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {readRecordingReview,object,privateHeaders} from '../lib/required-call-recording.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
import {secondaryCallingReady} from '../lib/business-voice-numbers.ts';
import {primaryBusinessPhone,isAdditionalBusinessPhone,businessVoiceIngress} from '../lib/business-phone-policy.ts';
const now=Date.now(),account='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',ownerInboundTarget={accountId:account,ownerUserId:user,ownerPhone:'+12125550199'};
const ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32),line='+18623812530',future=new Date(now+3600000).toISOString();
const review={enabled:true,reviewedAt:new Date(now-1000).toISOString(),reviewedUntil:future,agentId:'agent_fixture',branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',configHash:'c'.repeat(64),fromPhone:primaryBusinessPhone,providerAccountSid:ac,stopToolId:'tool_stop',contractToolId:'tool_offer',offerPolicy:'automatic_offer_v9',toolIds:['tool_stop','tool_offer','tool_callback','tool_handoff'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:'required-audio-30d-speech-v1'};
function fixture(){
 const rows={account:[{owner_user_id:user,bot_paused:false}],wallet:[{balance_cents:737,reserved_cents:0}],member:true,channel:true,stops:[],voice:[{enabled:true,reviewed_until:future,agent_id:review.agentId,agent_config_hash:review.configHash,phone_number_id:'phnum_fixture',max_duration_seconds:600,required_tool_ids:review.toolIds}],senders:[{phone:primaryBusinessPhone},{phone:line}],callers:[{phone:line}],smsRates:[{id:'sms-rate'}],smsRate:true,settings:[{enabled:true,model:'gpt-4.1-mini',rate:{enabled:true,operation:'sms_ai',expires_at:future}}],templates:[{provider_template_id:'123',placeholder_names:['Seller','Buyer'],field_map:{address:'Address'},reviewed_until:future,rate:{enabled:true,operation:'contract_signing',expires_at:future}}],business:[{outbound_enabled:true,forwarding_ready:true,provider_account_sid:ac,caller_id_sid:pn}]};
 const payloads={carrier:{sid:ac,status:'active',auth_token:'SYNTHETIC_SECRET_TOKEN'},leases:{data:{numbers:[primaryBusinessPhone,line].map(e164=>({number:{e164},lease_status:'active',capabilities:{channels:['sms']}}))}},primary:{phone_number:primaryBusinessPhone},caller:{outgoing_caller_ids:[{phone_number:line,account_sid:ac,sid:pn}],next_page_uri:null},ingress:{incoming_phone_numbers:[{phone_number:businessVoiceIngress,account_sid:ac,capabilities:{voice:true},voice_method:'POST',voice_url:'https://www.geticashx.com/api/reception/recorded/inbound'}],next_page_uri:null},forward:{object:'response',data:{number:line,call_forwarding:{enabled:true,to:businessVoiceIngress,status:'active',estimated_completion:null}}},template:{id:123,submitters:[{name:'Seller'},{name:'Buyer'}],fields:[{name:'Address'}]}};
 const env={ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'SYNTHETIC_SECRET_TOKEN',ELEVENLABS_API_KEY:'SYNTHETIC_SECRET_TOKEN',CONTIGUITY_FROM:primaryBusinessPhone,CONTIGUITY_API_KEY:'SYNTHETIC_SECRET_TOKEN',CONTIGUITY_WEBHOOK_SECRET:'SYNTHETIC_SECRET_TOKEN',OPENAI_API_KEY:'SYNTHETIC_SECRET_TOKEN',DOCUSEAL_API_KEY:'SYNTHETIC_SECRET_TOKEN',DOCUSEAL_MODE:'live'};
 const calls=[],queries=[];let agentPass=true,fail=null;
 const db=async(path,method='GET',body)=>{
  queries.push({path,method,body});
  if(path.startsWith('rpc/')){assert.equal(method,'POST');if(path==='rpc/icash_membership_work_allowed'){assert.deepEqual(body,{p_account:account});return rows.member;}if(path==='rpc/icash_outreach_voice_current')return rows.channel;if(path==='rpc/icash_sms_intake_rate_current'){assert.deepEqual(body,{p_rate:'sms-rate'});return rows.smsRate;}assert.fail('No other RPC permitted: '+path);}
  assert.equal(method,'GET');if(fail==='database')throw Error('SYNTHETIC_SECRET_TOKEN');
  const table=path.split('?')[0];
  if(['icash_accounts','icash_wallets','icash_voice_configs'].includes(table))assert(path.includes('eq.'+account));
  const key={icash_accounts:'account',icash_wallets:'wallet',icash_voice_configs:'voice',icash_text_suppressions:'stops',icash_text_senders:'senders',icash_operation_rates:'smsRates',icash_text_ai_settings:'settings',icash_signing_templates:'templates',icash_business_voice_numbers:path.includes('phone=eq.')?'business':'callers'}[table];assert(key,path);return structuredClone(rows[key]);
 };
 const fetcher=async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal);assert.equal(new Set(calls).size,calls.length,'Shared metadata is read once per inspection');
  if(fail&&url.includes(fail))throw Error('SYNTHETIC_SECRET_TOKEN');
  const key=url.includes('/numbers/leased')?'leases':url.includes('/phone-numbers/')?'primary':url.includes('/OutgoingCallerIds')?'caller':url.includes('/IncomingPhoneNumbers')?'ingress':url.includes('/call_forwarding')?'forward':url==='https://api.docuseal.com/templates/123'?'template':url==='https://api.twilio.com/2010-04-01/Accounts/'+ac+'.json'?'carrier':null;assert(key,url);
  return Response.json(payloads[key]);
 };
 const inspect=async()=>{
  const {readDemoReadiness}=await loadService('lib/demo-readiness.ts',{ownerInboundTarget,readRecordingReview,object,boundedBytes,secondaryCallingReady,primaryBusinessPhone,isAdditionalBusinessPhone,readRecordedOutboundReadiness:async(input,options)=>{assert.equal(input.RECORDED_OUTBOUND_REVIEW_JSON,env.RECORDED_OUTBOUND_REVIEW_JSON);assert(options.signal);return {providerChecksPass:agentPass};}});
  return readDemoReadiness(env,{db,fetcher,now:()=>now});
 };
 return {rows,payloads,env,calls,queries,inspect,fail:value=>{fail=value;},agent:value=>{agentPass=value;}};
}
const good=fixture(),result=await good.inspect();assert.equal(result.setupChecksPass,true);assert.equal(result.checks.length,5);assert.equal(result.mode,'read_only');assert.equal(result.callsPlaced,0);assert.equal(result.messagesSent,0);assert.equal(result.liveCallVerified,false);assert.equal(good.calls.length,7);
for(const sensitive of ['SYNTHETIC_SECRET_TOKEN',account,user,ac,pn,line,ownerInboundTarget.ownerPhone,review.configHash])assert(!JSON.stringify(result).includes(sensitive));
for(const [id,mutate] of [
 ['account',f=>f.rows.account[0].bot_paused=true],['account',f=>f.rows.account[0].owner_user_id='foreign'],['account',f=>f.rows.wallet[0].balance_cents=0],['account',f=>f.rows.member=false],['account',f=>f.rows.channel=false],['account',f=>f.rows.stops=[{}]],
 ['agent',f=>f.agent(false)],['agent',f=>f.rows.voice[0].agent_config_hash='d'.repeat(64)],['agent',f=>f.env.RECORDED_OUTBOUND_REVIEW_JSON='bad'],['agent',f=>f.env.ICASH_RECORDING_RECEIPTS_READY='false'],
 ['calling',f=>f.payloads.caller.outgoing_caller_ids[0].account_sid='foreign'],['calling',f=>f.payloads.forward.data.call_forwarding.status='queued'],['calling',f=>f.rows.senders=[]],['calling',f=>f.payloads.carrier.status='suspended'],['calling',f=>f.payloads.carrier.sid='foreign'],
 ['text',f=>f.payloads.leases.data.numbers[0].lease_status='inactive'],['text',f=>f.rows.smsRate=false],['text',f=>f.rows.settings[0].rate.expires_at=new Date(now-1).toISOString()],['text',f=>f.env.OPENAI_API_KEY=''],
 ['contract',f=>f.rows.templates.push(f.rows.templates[0])],['contract',f=>f.payloads.template.fields=[]],['contract',f=>f.payloads.template.id=999],['contract',f=>f.rows.templates[0].rate.enabled=false],['contract',f=>f.env.DOCUSEAL_MODE='test'],
]){const f=fixture();mutate(f);const r=await f.inspect();assert.equal(r.setupChecksPass,false,id);assert.equal(r.checks.find(c=>c.id===id).status,'blocked',id);}
for(const [failure,id] of [['api.docuseal.com','contract'],['OutgoingCallerIds','calling'],['numbers/leased','text'],['database','account']]){const f=fixture();f.fail(failure);const r=await f.inspect();assert.equal(r.setupChecksPass,false);assert.equal(r.checks.find(c=>c.id===id).status,'unavailable');assert(!JSON.stringify(r).includes('SYNTHETIC_SECRET_TOKEN'));}

let owner={accountId:account,userId:user},reads=0;
const route=await loadService('app/api/demo/readiness/route.ts',{dashboardWorkAccount:async()=>owner,ownerInboundTarget,privateHeaders,readDemoReadiness:async()=>{reads++;return result;},db:()=>assert.fail('No direct database action'),process:{env:{}}});
const req=(query='',headers={})=>new Request('https://www.geticashx.com/api/demo/readiness'+query,{headers:{host:'www.geticashx.com',...headers}});
assert.equal(route.POST,undefined);assert.equal((await route.GET(req('?account=foreign'))).status,400);assert.equal((await route.GET(req('',{host:'foreign'}))).status,400);assert.equal((await route.GET(req('',{origin:'https://foreign.invalid'}))).status,403);assert.equal((await route.GET(req('',{'sec-fetch-site':'cross-site'}))).status,403);
owner={accountId:'foreign',userId:user};assert.equal((await route.GET(req())).status,403);owner={accountId:account,userId:'foreign'};assert.equal((await route.GET(req())).status,403);assert.equal(reads,0);
owner={accountId:account,userId:user};const response=await route.GET(req());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(reads,1);

// Execute the actual client handler to verify duplicate clicks, stale success,
// cancellation and error recovery without a browser or a provider request.
const ui=readFileSync('components/demo-readiness.tsx','utf8');
const handler=ts.transpileModule(ui.slice(ui.indexOf(' async function check()'),ui.indexOf(' useEffect(')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const state={ready:false,busy:false,result:null,error:''},pending={current:null};let resolve,count=0;
const action=new Function('fetch','pending','onChange','setBusy','setResult','setError','return '+handler)(async(url,options)=>{assert.equal(url,'/api/demo/readiness');assert.equal(options.method,'GET');count++;return new Promise(r=>{resolve=r;});},pending,v=>state.ready=v,v=>state.busy=v,v=>state.result=v,v=>state.error=v);
let work=action();await action();assert.equal(count,1);assert.equal(state.ready,false);resolve(Response.json(result));await work;assert.equal(state.ready,true);assert.equal(state.busy,false);
work=action();assert.equal(state.ready,false);assert.equal(state.result,null);resolve(new Response('SYNTHETIC_SECRET_TOKEN',{status:503}));await work;assert.equal(state.ready,false);assert.equal(state.busy,false);assert(!state.error.includes('SYNTHETIC_SECRET_TOKEN'));
work=action();pending.current.abort();pending.current=null;resolve(Response.json(result));await work;assert.equal(state.ready,false,'A response after navigation must not enable Start');
console.log('PASS owner pre-call setup: read-only providers and allowlisted database checks, per-stage failures, private owner authentication, no call/send/charge claims, duplicate clicks and canceled responses.');
