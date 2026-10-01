import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {liveWorkReady,discoveryWorkEnabled,contactWorkEnabled,smsWorkEnabled,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '../lib/live-work-admission.ts';
let seq=0;
async function load(file,deps){const key='__admission'+seq++;globalThis[key]=deps;let source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');try{return await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}finally{delete globalThis[key];}}
process.env.ICASH_LIVE_WORK_READY='false';delete process.env.ICASH_DISCOVERY_WORK_READY;delete process.env.ICASH_SMS_WORK_READY;process.env.ICASH_EARLY_ACCESS_FUNDING_ENABLED='true';process.env.ICASH_LIVE_PAYMENTS_ENABLED='true';
assert.equal(liveWorkReady(),false);assert.equal(liveWorkReady({}),false);assert.equal(liveWorkReady({ICASH_LIVE_WORK_READY:'true'}),true);
// Actual service functions return before a provider request, claim, or new reserve.
for(const [file,fn] of Object.entries({'discovery-service':'discoverForAccount','live-dispatch-service':'dispatchLiveVoice','owner-enrichment-service':'enrichForAccount','market-expansion-service':'expandMarket','text-ai-service':'processTextAi','text-message-service':'dispatchTextMessage','fulfillment-service':'prepareFulfillment','title-followup-service':'dispatchTitleFollowup','deal-email-service':'dispatchDealEmail','title-service':'dispatchTitleRequest','title-directory-service':'qualifyTitleCompanies','buyer-discovery-service':'discoverBuyersForDeal','buyer-package-email':'sendRequestedBuyerPackages'})){
 const service=await load('lib/'+file+'.ts',{z,liveWorkReady,discoveryWorkEnabled,contactWorkEnabled,smsWorkEnabled,db:async()=>{throw Error('No DB or provider work may start');}});
 assert.equal((await service[fn]('account','job')).status,'live_work_not_ready',file);
}
const costs=await load('lib/operating-costs.ts',{liveWorkReady,discoveryWorkEnabled,contactWorkEnabled,db:async()=>{throw Error('Unexpected reserve');}});await assert.rejects(()=>costs.reserveOperation({}),/Live work is not ready/);
let rows=[],priorAttempts=2,existingOperation=false,cas=true;
const token='00000000-0000-0000-0000-000000000000'.repeat(2),base={id:'ticket',accountId:'account',kind:'contacts',screeningId:'screen'};
const db=async(path,method,body)=>{rows.push({path,method,body});if(path.startsWith('icash_operation_spend'))return existingOperation?[{}]:[];if(path.startsWith('icash_automation_tickets'))return method==='PATCH'?(cas?[{id:'ticket'}]:[]):[{issue_attempts:priorAttempts}];return [];};
assert.equal((await deferUnstartedAutomation(db,base,token)).status,'live_work_not_ready');let patch=rows.find(r=>r.method==='PATCH');assert(patch.path.includes('token=eq.'+token)&&patch.path.includes('state=eq.consumed')&&patch.path.includes('issue_attempts=eq.2')&&patch.path.includes('account_id=eq.account'));assert.equal(patch.body.issue_attempts,1);assert.equal(patch.body.state,'held');assert.equal(patch.body.outcome,'expired');assert(Date.parse(patch.body.expires_at)<=Date.now());assert(!rows.some(r=>r.path.startsWith('icash_operation_spend')&&r.method));
rows=[];priorAttempts=1;await deferUnstartedAutomation(db,base,token);assert.equal(rows.find(r=>r.method==='PATCH').body.issue_attempts,1,'never violate attempt lower bound');
rows=[];existingOperation=true;await assert.rejects(()=>deferUnstartedAutomation(db,base,token),/reconciliation/);assert(!rows.some(r=>r.method==='PATCH'),'never decrement attempts after an actual/reserved operation');existingOperation=false;
rows=[];cas=false;await assert.rejects(()=>deferUnstartedAutomation(db,{...base,kind:'text_ai',textAiJobId:'text'},'stale-token'),/Ticket changed/);assert.equal(rows.filter(r=>r.method==='PATCH').length,1,'CAS failure never resets an associated job');cas=true;
rows=[];await deferUnstartedAutomation(db,{...base,kind:'voice_dispatch',voiceJobId:'voice'},token);assert(rows.some(r=>r.path.includes('icash_voice_jobs')&&r.path.includes('state=eq.issued')&&r.body.state==='ready'));assert(!rows.some(r=>r.body?.due_at),'do not rewrite promised callback times');
rows=[];await deferUnstartedAutomation(db,{...base,kind:'seller_opener',openerMessageId:'message'},token);assert(rows.some(r=>r.path.includes('state=eq.ready')&&r.body.state==='needs_review'),'keep unstarted opener visible for review');
await assert.rejects(()=>deferUnstartedAutomation(db,{...base,kind:'voice_result'},token),/Not a new-work ticket/);
// Actual control route: only resume/return-to-bot is denied, and pause still cancels billing.
let writes=[],stops=0;
const response={json:(body,options={})=>({body,status:options.status??200})};
const control=await load('app/api/work/control/route.ts',{NextResponse:response,z,contactAccountReadiness:async()=>({ready:false}),discoveryAccountReadiness:async()=>({ready:false}),smsAccountReady:async()=>false,allowedOrigin:()=>true,workAccount:async()=>({accountId:'account',userId:'user'}),fundingMode:()=> 'live',stopDaily:async()=>{stops++;},db:async(path,_method,body)=>{writes.push({path,body});return path.startsWith('icash_daily_plans')?[{id:'plan'}]:[];}});
const request=body=>new Request('https://example.invalid/api/work/control',{method:'POST',body:JSON.stringify(body)});
for(const action of ['resume','return_to_bot']){assert.equal((await control.POST(request({action}))).status,503);assert.equal(writes.length,0);}
assert.equal((await control.POST(request({action:'pause'}))).status,200);assert.equal(stops,1);assert.equal((await control.POST(request({action:'takeover'}))).status,200);
// Actual automation route skips every new-work kind, but still settles previous usage.
let kind='discovery',dispatches=0,reconciles=0,settles=0;
const mocks={liveWorkReady,discoveryWorkEnabled,contactWorkEnabled,smsWorkEnabled,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation,NextResponse:response,readVoiceUsagePolicies:()=>[],settlePendingVoiceUsage:async()=>{settles++;return {status:'settled'};},db:async(path,method,body)=>path==='rpc/icash_consume_automation'?{...base,kind,liveCallId:'call',signingId:'sign',voiceJobId:'voice',fulfillmentJobId:'fulfill',titleTaskId:'title',textAiJobId:'text',marketResearchJobId:'market',openerMessageId:'opener'}:db(path,method,body),reconcileLiveConversation:async()=>{reconciles++;return {status:'conversation_saved'};},refreshSigning:async()=>{reconciles++;return {status:'completed'};},dispatchAttentionNotification:async()=>({status:'attention_idle'})};
for(const fn of ['dispatchTextMessage','expandMarket','processTextAi','dispatchTitleFollowup','prepareFulfillment','dispatchLiveVoice','discoverForAccount','enrichForAccount'])mocks[fn]=async()=>{dispatches++;return {status:'unexpected'};};
const automation=await load('app/api/internal/automation/route.ts',mocks),automationRequest=()=>new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+token}});
process.env.ICASH_ATTENTION_EMAIL_ENABLED='false';
for(kind of newLiveWorkKinds){assert.equal((await automation.POST(automationRequest())).body.status,'live_work_not_ready',kind);}
assert.equal(dispatches,0);assert.equal(settles,newLiveWorkKinds.size);
process.env.ICASH_SMS_WORK_READY='true';kind='seller_opener';assert.equal((await automation.POST(automationRequest())).body.status,'unexpected');assert.equal(dispatches,1);for(kind of newLiveWorkKinds){if(kind!=='seller_opener')assert.equal((await automation.POST(automationRequest())).body.status,'live_work_not_ready',kind);}assert.equal(dispatches,1);delete process.env.ICASH_SMS_WORK_READY;
for(kind of ['voice_result','signing_result','customer_attention'])assert.equal((await automation.POST(automationRequest())).status,200);assert.equal(reconciles,2);
// New inbound calls are denied before routing/reserving; existing callback/result routes stay separate.
const inbound=await load('app/api/internal/voice/inbound/route.ts',{NextResponse:response,inboundAuthorized:()=>true,db:async()=>{throw Error('No inbound reserve');}});assert.equal((await inbound.POST(request({}))).status,503);
// Signing polling records existing results but cannot claim a new live auto-signature.
let autoClaims=0,polls=0,saved=0;process.env.DOCUSEAL_API_KEY='fixture';
const signing=await load('lib/signing-service.ts',{z,normalize:()=>({}),verifiedSigningStatus:()=> 'customer_signature_needed',signingFields:()=>({}),dealTermsSchema:{parse:x=>x},signingDocumentReadiness:()=>{},db:async path=>{if(path.startsWith('icash_signing_envelopes'))return [{id:'env',provider_id:'1',state:'awaiting_counterparty',test_mode:false,terms:{},recipients:[]}];if(path==='rpc/icash_claim_signing_poll')return true;if(path.startsWith('icash_signing_templates'))return [{}];if(path==='rpc/icash_save_signing_status'){saved++;return;}if(path==='rpc/icash_claim_auto_signature'){autoClaims++;return 'must-not-sign';}throw Error(path);}});
const oldFetch=globalThis.fetch;try{globalThis.fetch=async()=>{polls++;return Response.json({submitters:[]});};assert.equal((await signing.refreshSigning('account','env')).status,'customer_signature_needed');assert.equal(polls,1);assert.equal(saved,1);assert.equal(autoClaims,0);}finally{globalThis.fetch=oldFetch;}
console.log('Live work admission: API resume, 13 real services, reserve guard, all automation kinds, CAS-safe deferral, stop/cancel, receipts/usage and signing-poll separation passed.');
