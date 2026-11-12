import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {contiguityPreflight,sendContiguityText} from '../lib/contiguity.ts';
import {elevenRequest} from '../lib/elevenlabs.ts';
import {boundedBytes,createRecordingProviders} from '../lib/required-call-recording-provider.ts';
import {createRecordedReceptionProviders} from '../lib/recorded-reception-provider.ts';
import {createOwnerInboundProviders} from '../lib/owner-inbound-providers.ts';
import {readVoiceCapacityProvider} from '../lib/voice-capacity.ts';
import {analyzeText} from '../lib/text-ai-policy.ts';
import {webinarAI} from '../lib/webinar-ai.ts';

// Synthetic responses and a loopback server only: no provider calls or spend.
const savedEnv={...process.env},nativeFetch=globalThis.fetch;
Object.assign(process.env,{ELEVENLABS_API_KEY:'fixture',OPENAI_API_KEY:'fixture',ICASH_SUPPORT_AI_MODEL:'gpt-4.1-mini',ICASH_SUPPORT_AI_ENABLED:'true'});
const env={ELEVENLABS_API_KEY:'fixture',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'fixture-only-not-a-secret'};
const call='CA'+'b'.repeat(32),recording='RE'+'c'.repeat(32);
const ownerConfig={agentId:'agent_fixture',branchId:'agtbrch_fixture',phoneNumberId:'phnum_fixture',twilioAccountSid:env.TWILIO_ACCOUNT_SID,elevenLabsRegion:'us',twilioRegion:'us1'};
const support=await loadService('lib/support-ai.ts',{z,supportTopics:['help'],supportTopic:()=> 'help',redactSupportQuestion:value=>value});
const assistant=await loadService('lib/workspace-assistant-ai.ts',{z,assistantIntents:['help'],localAssistantIntent:()=> 'help',coachActions:()=>[],dealCoachInstructions:'Fixture instructions'});
const context={selectedId:null,properties:[],checkedAt:new Date().toISOString(),paused:false,balanceCents:100};
function unfinished(status=503,{headers={},rejectCleanup=false,redirected=false}={}){
 let cancelled=0;
 const response=new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode('private response must not enter errors'));},
  cancel(){cancelled++;if(rejectCleanup)throw Error('private cleanup failure');},
 }),{status,headers});
 if(redirected)Object.defineProperty(response,'redirected',{value:true});
 return {response,cancelled:()=>cancelled};
}
try{
 await test('provider HTTP failures release their connections and keep their original outcome',async()=>{
  const actions=[
   ['SMS metadata',fetcher=>contiguityPreflight('fixture',fetcher),/CONTIGUITY_HTTP_503/],
   ['SMS send',fetcher=>sendContiguityText({from:'+15555550101',to:'+15555550102',message:'fixture'},'fixture',fetcher),/CONTIGUITY_HTTP_503/],
   ['carrier read',fetcher=>createRecordingProviders(env,fetcher).getCall(call),/RECORDING_PROVIDER_UNAVAILABLE/],
   ['carrier dial',fetcher=>createRecordingProviders(env,fetcher).dial('+15555550101','+15555550102','fixture','https://fixture.invalid'),/RECORDING_PROVIDER_UNAVAILABLE/],
   ['carrier diagnostics',fetcher=>createRecordingProviders(env,fetcher).listCallCreationAlerts('2026-11-12T12:00:00Z'),/RECORDING_PROVIDER_UNAVAILABLE/],
   ['outgoing agent',fetcher=>createRecordingProviders(env,fetcher).agent({agentId:'agent_fixture',branchId:'agtbrch_fixture'}),/RECORDING_PROVIDER_UNAVAILABLE/],
   ['incoming agent',fetcher=>createRecordedReceptionProviders(env,fetcher).agent({agent_id:'agent_fixture',branch_id:'agtbrch_fixture'}),/PROVIDER_UNAVAILABLE/],
   ['owner inbound',fetcher=>createOwnerInboundProviders(ownerConfig,{env,fetcher}).agent(),/OWNER_INBOUND_PROVIDER_UNAVAILABLE/],
   ['call capacity',fetcher=>readVoiceCapacityProvider('/v1/user/subscription','global',env,fetcher),/VOICE_CAPACITY_READ_HTTP_503/],
   ['text AI',fetcher=>analyzeText({model:'fixture',context:{},messages:[]},'fixture',fetcher),/TEXT_AI_PROVIDER_HTTP_503/],
   ['support AI',async fetcher=>assert.deepEqual(await support.classifySupportQuestion('help',[],fetcher),{topic:'help',ai:false})],
   ['workspace AI',async fetcher=>{
    const receipts=[];const result=await assistant.routeWorkspaceQuestion('help',context,[],fetcher,{before:async()=>true,after:async receipt=>receipts.push(receipt)});
    assert.equal(result.coaching,null);assert.deepEqual(receipts,[{providerId:null,usage:null}],'No fabricated zero usage or successful answer');
   }],
   ['webinar AI',async fetcher=>{globalThis.fetch=fetcher;assert.equal(await webinarAI('fixture','fixture'),null);}],
  ];
  for(const [label,action,error] of actions)for(const rejectCleanup of [false,true]){
   let requests=0;const fixture=unfinished(503,{rejectCleanup});
   const fetcher=async()=>{requests++;return fixture.response;};
   try{if(error)await assert.rejects(action(fetcher),error);else await action(fetcher);}
   finally{globalThis.fetch=nativeFetch;}
   assert.equal(fixture.cancelled(),1,label+' releases its body even if cleanup rejects');
   assert.equal(requests,1,label+' never replays an attempt');
  }
 });

 await test('size, media type, redirects and unexpected deletion receipts close before rejection',async()=>{
  for(const headers of [{'content-length':'999999'},{'content-length':'invalid'}]){
   const fixture=unfinished(200,{headers,rejectCleanup:true});
   await assert.rejects(boundedBytes(fixture.response,1024),/BODY_LIMIT/);assert.equal(fixture.cancelled(),1);
  }
  const oversized=unfinished(200);
  await assert.rejects(boundedBytes(oversized.response,4),/BODY_LIMIT/);assert.equal(oversized.cancelled(),1);
  for(const [action,options,error] of [
   [p=>p.media(recording),{headers:{'content-type':'text/html'}},/AUDIO_TYPE_INVALID/],
   [p=>p.deleteRecording(recording),{},/DELETION_NOT_CONFIRMED/],
   [p=>p.getCall(call),{redirected:true},/RECORDING_PROVIDER_UNAVAILABLE/],
  ]){
   const fixture=unfinished(200,options);let requests=0;
   await assert.rejects(action(createRecordingProviders(env,async()=>{requests++;return fixture.response;})),error);
   assert.equal(fixture.cancelled(),1);assert.equal(requests,1);
  }
  for(const headers of [{'content-type':'text/html'},{'content-type':'application/json','content-length':'99999999'}]){
   const fixture=unfinished(200,{headers});
   await assert.rejects(createOwnerInboundProviders(ownerConfig,{env,fetcher:async()=>fixture.response}).agent(),/OWNER_INBOUND_PROVIDER_RECEIPT_INVALID/);
   assert.equal(fixture.cancelled(),1);
  }
  const bytes=Buffer.from('valid body');assert.deepEqual(await boundedBytes(new Response(bytes),bytes.length),bytes);
 });

 await test('voice writes with malformed or interrupted success bodies remain unknown, once only',async()=>{
  for(const body of [undefined,{fixture:true}])for(const response of [new Response('private malformed JSON'),new Response(new ReadableStream({start(c){c.error(new DOMException('private lost body','AbortError'));}}))]){
   let requests=0;
   await assert.rejects(elevenRequest('/fixture',body,async()=>{requests++;return response;}),{message:body===undefined?'VOICE_INVALID_RESPONSE':'VOICE_WRITE_UNKNOWN_NO_RETRY'});
   assert.equal(requests,1);
  }
  const huge=unfinished(503,{headers:{'content-length':'999999'}});
  await assert.rejects(elevenRequest('/fixture',undefined,async()=>huge.response),{message:'VOICE_HTTP_503'});assert.equal(huge.cancelled(),1);
  await assert.rejects(elevenRequest('/fixture',undefined,async()=>Response.json({detail:{message:'private value missing convai_read'}},{status:403})),{message:'VOICE_HTTP_403_CONVAI_READ'});
  await assert.rejects(elevenRequest('/fixture',{},async()=>Response.json({detail:[{loc:['body','agent_id'],type:'invalid',input:'private'}]},{status:422})),{message:'VOICE_HTTP_422_BODY_AGENT_ID'});
  assert.deepEqual(await elevenRequest('/fixture',{},async()=>Response.json({id:'saved',future_metadata:{enabled:true}})),{id:'saved',future_metadata:{enabled:true}},'Additional response fields do not invalidate successful receipts');
 });

 await test('contract and deal email failures retain reconciliation without resending',async()=>{
  const signing=await loadService('lib/signing-service.ts',{z,db:async path=>path.startsWith('rpc/')?true:[{id:'fixture',provider_id:'123'}]});
  process.env.DOCUSEAL_API_KEY='fixture';
  let requests=0;const failedSigning=unfinished();
  globalThis.fetch=async()=>{requests++;return failedSigning.response;};
  await assert.rejects(signing.customerSigningLink('account','fixture','fixture@example.invalid'),/Do not resend until its status is checked/);
  assert.equal(requests,1);assert.equal(failedSigning.cancelled(),1);
  const writes=[];const email=await loadService('lib/deal-email-service.ts',{
   db:async(path,method,body)=>{if(method==='PATCH'){writes.push(body);return [];}return path.startsWith('rpc/')?{id:'fixture',to:'fixture@example.invalid',subject:'fixture',text:'fixture',principal:'fixture'}:[{state:'ready'}];},
   customerEmailDomains:()=>true,customerEmailIdentity:()=>({from:'fixture@example.invalid',replyTo:'fixture@example.invalid'}),titleEmailAddress:value=>value,emailFromName:()=> 'fixture',
  });
  Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture'});
  const failedEmail=unfinished();requests=0;
  globalThis.fetch=async()=>{requests++;return failedEmail.response;};
  assert.deepEqual(await email.dispatchDealEmail('account','fixture'),{status:'email_needs_review'});
  assert.equal(requests,1);assert.equal(failedEmail.cancelled(),1);assert.equal(writes.length,1);assert.equal(writes[0].state,'needs_review');
  globalThis.fetch=nativeFetch;
 });

 await test('real provider HTTP errors close unfinished streams immediately',async()=>{
  let requests=0,closed;
  const server=http.createServer((_request,response)=>{requests++;response.on('close',()=>closed?.());response.writeHead(503,{'Content-Type':'text/plain'});response.write('private body stays open');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
   for(const action of [fetcher=>contiguityPreflight('fixture',fetcher),fetcher=>createRecordingProviders(env,fetcher).getCall(call),fetcher=>analyzeText({model:'fixture',context:{},messages:[]},'fixture',fetcher)]){
    const connectionClosed=new Promise(resolve=>{closed=resolve;});let timer;
    await assert.rejects(action((_url,init)=>nativeFetch(url,init)));
    try{await Promise.race([connectionClosed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Provider connection left open')),1000);})]);}finally{clearTimeout(timer);}
   }
   assert.equal(requests,3);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });
}finally{
 globalThis.fetch=nativeFetch;
 for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];
 Object.assign(process.env,savedEnv);
}
