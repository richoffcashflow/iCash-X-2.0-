import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {liveWorkReady,discoveryWorkEnabled,contactWorkEnabled,smsWorkEnabled,automationWorkReady,newLiveWorkKinds} from '../lib/live-work-admission.ts';
import {workspaceStatus,workspaceNextAction} from '../lib/workspace-status.ts';
let seq=0;
async function load(file,deps){const key='__smsChannel'+seq++;globalThis[key]=deps;let source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');try{return await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}finally{delete globalThis[key];}}
assert.equal(smsWorkEnabled({}),false);assert.equal(smsWorkEnabled({ICASH_SMS_WORK_READY:'TRUE'}),false);
const env={ICASH_LIVE_WORK_READY:'false',ICASH_SMS_WORK_READY:'true'};
assert.equal(liveWorkReady(env),false);assert.equal(smsWorkEnabled(env),true);
for(const kind of newLiveWorkKinds)assert.equal(automationWorkReady(kind,env),kind==='seller_opener',kind);
process.env.ICASH_LIVE_WORK_READY='false';delete process.env.ICASH_DISCOVERY_WORK_READY;process.env.ICASH_SMS_WORK_READY='true';
process.env.CONTIGUITY_FROM='+12125550123';process.env.CONTIGUITY_API_KEY='synthetic';process.env.CONTIGUITY_WEBHOOK_SECRET='synthetic';
let release=true,sender=true,rate=true,reads=[];
const {smsAccountReady}=await load('lib/sms-channel-readiness.ts',{smsWorkEnabled,db:async(path,method,body)=>{
 reads.push({path,method,body});if(path==='rpc/icash_sms_inbound_campaign_status'){assert.deepEqual(body,{p_account:'account',p_user:'owner'});return {released:release};}
 if(path.startsWith('icash_text_senders?')){assert(path.includes(encodeURIComponent(process.env.CONTIGUITY_FROM)));return sender?[{phone:process.env.CONTIGUITY_FROM}]:[];}
 if(path.startsWith('icash_operation_rates?'))return [{id:'rate'}];if(path==='rpc/icash_sms_intake_rate_current')return rate;throw Error(path);
}});
assert.equal(await smsAccountReady('account','owner'),true);
release=false;assert.equal(await smsAccountReady('account','owner'),false);release=true;
sender=false;assert.equal(await smsAccountReady('account','owner'),false);sender=true;
rate=false;assert.equal(await smsAccountReady('account','owner'),false);rate=true;
assert(reads.every(x=>!['PATCH','PUT','DELETE'].includes(x.method)),'readiness cannot mutate campaign/account/rates');
let canRun=false,writes=[];const response={json:(body,o={})=>({body,status:o.status??200})};
const control=await load('app/api/work/control/route.ts',{NextResponse:response,z,contactAccountReadiness:async()=>({ready:false}),discoveryAccountReadiness:async()=>({ready:false}),allowedOrigin:()=>true,workAccount:async()=>({accountId:'account',userId:'owner'}),smsAccountReady:async(a,u)=>{assert.equal(a,'account');assert.equal(u,'owner');return canRun;},db:async(path,method,body)=>{writes.push({path,body});return [];},stopDaily:async()=>{},fundingMode:()=> 'live'});
const req=action=>new Request('https://example.invalid/api/work/control',{method:'POST',body:JSON.stringify({action})});
assert.equal((await control.POST(req('resume'))).status,503);assert.equal(writes.length,0);
canRun=true;assert.equal((await control.POST(req('resume'))).status,200);assert.deepEqual(writes[0],{path:'rpc/icash_set_work_control',body:{p_user:'owner',p_account:'account',p_action:'resume',p_screening:null}});
writes=[];assert.equal((await control.POST(req('return_to_bot'))).status,503);assert.equal(writes.length,0);
assert.equal((await control.POST(req('pause'))).status,200);assert.equal(writes[0].path,'rpc/icash_pause_work_and_billing');
let invitation=false,claim=true,provider=0,claims=0,accepted=0;
const text=await load('lib/text-message-service.ts',{liveWorkReady,discoveryWorkEnabled,contactWorkEnabled,smsWorkEnabled,sameBusinessNumber:(a,b)=>a===b,textPayload:()=>{},elevenRequest:async()=>{throw Error('Voice must remain unused');},sendContiguityText:async job=>{provider++;assert.equal(job.id,'claimed');return {messageId:'receipt'};},db:async(path,method,body)=>{
 if(path.startsWith('icash_text_messages?'))return [{body:'Synthetic allowed SMS',attachments:[],thread_id:'thread'}];
 if(path.startsWith('icash_sms_inbound_invitations?')){assert(path.includes('account_id=eq.account')&&path.includes('message_id=eq.message'));return invitation?[{id:'invite',reply_id:'received-reply'}]:[];}
 if(path==='rpc/icash_review_sms_campaign_reply'){assert.deepEqual(body,{p_account:'account',p_message:'received-reply'});return 'attention';}
 if(path.startsWith('icash_text_threads?'))return [{sender:process.env.CONTIGUITY_FROM,recipient:'+12125550124'}];
 if(path.startsWith('icash_voice_configs?'))return [{enabled:false}];
 if(path==='rpc/icash_claim_text'){claims++;assert.deepEqual(body,{p_account:'account',p_message:'message',p_sender:process.env.CONTIGUITY_FROM});return claim?{id:'claimed'}:null;}
 if(path==='rpc/icash_accept_text'){accepted++;assert.equal(body.p_provider,'receipt');return;}throw Error(path);
}});
invitation=true;assert.equal((await text.dispatchTextMessage('account','message')).status,'inbound_invitation_not_ready');assert.equal(claims,0);assert.equal(provider,0);
invitation=false;claim=false;assert.equal((await text.dispatchTextMessage('account','message')).status,'message_held');assert.equal(provider,0);
claim=true;assert.equal((await text.dispatchTextMessage('account','message')).status,'message_accepted');assert.equal(provider,1);assert.equal(accepted,1);
// A real route still rejects incoming calls before data or costs despite SMS flag being on.
const inbound=await load('app/api/internal/voice/inbound/route.ts',{NextResponse:response,inboundAuthorized:()=>true,db:async()=>{throw Error('No incoming reservation');}});assert.equal((await inbound.POST(req('resume'))).status,503);
// Other real services remain held, not just the automation-kind selector.
for(const [file,fn] of Object.entries({'live-dispatch-service':'dispatchLiveVoice','discovery-service':'discoverForAccount','text-ai-service':'processTextAi','fulfillment-service':'prepareFulfillment','title-service':'dispatchTitleRequest'})){
 const service=await load('lib/'+file+'.ts',{z,discoveryWorkEnabled,contactWorkEnabled,liveWorkReady,db:async()=>{throw Error('No other work');}});assert.equal((await service[fn]('account','job')).status,'live_work_not_ready');
}
const campaign={configured:true,released:true,liveWorkReady:false,smsChannelEnabled:true,policy:{version:'v'},acknowledgment:{version:'v'}};
const account={identity:{},paused:true,balanceCents:300,workReady:false,smsWorkReady:true};
assert.equal(workspaceNextAction(account,campaign).label,'Start SMS outreach');
assert.equal(workspaceNextAction(account,{...campaign,released:false}).kind,'campaign');
assert.equal(workspaceNextAction({...account,smsWorkReady:false},campaign).kind,'campaign');
assert.equal(workspaceStatus({...account,paused:false}).label,'SMS READY');
assert.match(workspaceStatus({...account,paused:false}).detail,/calls.*held/);
console.log('SMS-only admission: default OFF, exact ticket scope, current owner/release/sender/rate, explicit Run, atomic final claim, invitation hold, voice/other work hold, and truthful SMS display passed.');
