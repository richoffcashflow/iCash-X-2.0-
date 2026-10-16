import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import ts from 'typescript';
import {allowedOrigin} from '../lib/funding-policy.ts';
import {immediateSellerSubmission,sellerConsentVersion,sellerConsentText,sellerSharingText,sellerDuplicateKeyInput} from '../lib/seller-leads.ts';
import {botDemoSubmission,botDemoConsentVersion} from '../lib/bot-demo.ts';
import {optinCallNowVersion} from '../lib/optin-call-now.ts';
import {processSellerResponses} from '../lib/seller-response-service.ts';
import {sellerSubmissionStatus} from '../lib/seller-submission-status.ts';

// Run both actual handlers and their real validation/response service against
// in-memory claims. No network, provider, production DB or paid work is used.
const requestId='12345678-1234-4234-8234-123456789abc';
const ownerInboundTarget={ownerUserId:'fixture-owner',accountId:'fixture-account'};
const guestHash=value=>createHash('sha256').update(value).digest('hex');
let user,duplicate,events,callbacks,claimed,failRequest;
function reset(){user={id:ownerInboundTarget.ownerUserId};duplicate=false;events=[];callbacks=[];claimed=false;failRequest=false;}
const deps={
 NextResponse:Response,createHash,randomBytes,guestHash,ownerInboundTarget,
 allowedOrigin:req=>allowedOrigin(req,{}),currentUser:async()=>user,
 cookies:async()=>({get:name=>name==='keypath_seller'?{value:'a'.repeat(64)}:undefined,set:()=>{throw Error('Unexpected cookie mutation');}}),
 validGuest:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),limitRequest:async()=>{},
 botDemoSubmission,immediateSellerSubmission,sellerConsentText,sellerSharingText,sellerDuplicateKeyInput,sellerSubmissionStatus,
 after:callback=>{events.push({kind:'defer'});callbacks.push(callback);},
 processSellerIntake:async(_db,_key,_fetch,lead)=>{assert.equal(lead,'fixture-lead');events.push({kind:'lookup'});},
 processSellerResponses,
 dispatchTextMessage:async(account,id)=>{assert.equal(account,ownerInboundTarget.accountId);assert.equal(id,'fixture-text');events.push({kind:'text'});return {status:'message_accepted'};},
 dispatchLiveVoice:async(account,id)=>{assert.equal(account,ownerInboundTarget.accountId);assert.equal(id,'fixture-voice');events.push({kind:'voice'});return {status:'call_started'};},
 db:async(path,method,body)=>{
  events.push({kind:path,method,body});
  if(path==='rpc/icash_submit_bot_demo_intake'||path==='rpc/icash_submit_seller_contact_intake')return 'fixture-lead';
  if(path==='icash_seller_intakes?id=eq.fixture-lead&select=state&limit=1')return [{state:duplicate?'duplicate':'received'}];
  if(path==='rpc/icash_request_optin_call_now'){if(failRequest)throw Error('Cannot save explicit request');return true;}
  if(path==='rpc/icash_assign_seller_lead_for')return null;
  if(path==='rpc/icash_prepare_seller_responses'){
   if(claimed)return [];claimed=true;
   return [{leadId:'fixture-lead',accountId:ownerInboundTarget.accountId,screeningId:'fixture-screening',smsMessageId:'fixture-text',voiceJobId:'fixture-voice',status:'queued'}];
  }
  if(path==='rpc/icash_note_seller_response')return null;
  throw Error('Unexpected DB operation: '+path);
 },
};
globalThis.__optinCallNowRoute=deps;
async function load(path){
 const source=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 assert(!/^import /m.test(source));
 return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__optinCallNowRoute;\n'+source).toString('base64'));
}
const demo=await load('app/api/demo/intake/route.ts'),seller=await load('app/api/seller/intake/route.ts');
delete globalThis.__optinCallNowRoute;
const base={requestId,name:'Demo Seller',address:'123 Example St, Dallas, TX 75210',phone:'2145550123',consented:true,contactTimezone:'America/Chicago'};
const request=(kind,body,origin='https://fixture.example')=>new Request('https://fixture.example/api/'+kind+'/intake',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
const grants=()=>events.filter(e=>e.kind==='rpc/icash_request_optin_call_now');
const sends=()=>events.filter(e=>e.kind==='voice'||e.kind==='text');
for(const [kind,route,consentVersion,source] of [['demo',demo,botDemoConsentVersion,'demo_form'],['seller',seller,sellerConsentVersion,'seller_form']]){
 const body={...base,consentVersion,callNowVersion:optinCallNowVersion};
 for(const change of [{consented:false},{callNowVersion:'old-version'},{consentVersion:'old-consent'}]){
  reset();assert.equal((await route.POST(request(kind,{...body,...change}))).status,400);assert.equal(events.length,0,'Invalid consent/version must not persist or start work');
 }
 reset();assert.equal((await route.POST(request(kind,body,'https://untrusted.example'))).status,403);assert.equal(events.length,0,'Cross-origin request must not grant call-now permission');
 reset();const legacy={...body};delete legacy.callNowVersion;
 assert.equal((await route.POST(request(kind,legacy))).status,200);assert.equal(grants().length,0,'Original contact consent alone does not request an immediate call');assert.equal(sends().length,0);
 reset();failRequest=true;assert.equal((await route.POST(request(kind,body))).status,503);assert.equal(callbacks.length,0,'Do not run the pipeline if explicit request persistence failed');assert.equal(sends().length,0);
 reset();const accepted=await route.POST(request(kind,body));assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(grants().map(e=>e.body),[{p_lead:'fixture-lead',p_request:requestId,p_source:source,p_reference:optinCallNowVersion,...(kind==='demo'?{p_actor:ownerInboundTarget.ownerUserId,p_account:ownerInboundTarget.accountId}:{})}]);
 assert(events.findIndex(e=>e.kind==='rpc/icash_request_optin_call_now')<events.findIndex(e=>e.kind==='defer'),'Persist the explicit request before any background pipeline');
 assert.equal(sends().length,0,'Saving a form does not pretend a provider call happened');
 await callbacks.shift()();assert.deepEqual(sends().map(e=>e.kind),['text','voice']);
 assert.equal((await route.POST(request(kind,body))).status,200);await callbacks.shift()();
 assert.equal(sends().length,2,'A replay with no new durable claims cannot synthesize another send');
 assert(grants().every(e=>e.body.p_request===requestId),'Replay must keep the original request key');
}
reset();
const nameless={...base,consentVersion:sellerConsentVersion,callNowVersion:optinCallNowVersion};delete nameless.name;
assert.equal((await seller.POST(request('seller',nameless))).status,200);
assert.equal(events.find(e=>e.kind==='rpc/icash_submit_seller_contact_intake').body.p_name,null);
assert.equal(grants().length,1);await callbacks.shift()();assert.deepEqual(sends().map(e=>e.kind),['text','voice']);
reset();assert.equal((await demo.POST(request('demo',{...nameless,consentVersion:botDemoConsentVersion}))).status,400,'Private demo validation remains unchanged');assert.equal(events.length,0);
reset();user={id:'another-customer'};assert.equal((await demo.POST(request('demo',{...base,consentVersion:botDemoConsentVersion,callNowVersion:optinCallNowVersion}))).status,403);assert.equal(events.length,0);
reset();duplicate=true;
const duplicateResponse=await demo.POST(request('demo',{...base,consentVersion:botDemoConsentVersion,callNowVersion:optinCallNowVersion}));
assert.equal(duplicateResponse.status,200);assert.equal((await duplicateResponse.json()).progress.phase,'duplicate_demo');
assert.equal(grants().length,0,'An existing demo must not gain another immediate-call grant');assert.equal(callbacks.length,0);assert.equal(sends().length,0);
console.log('PASS real opt-in routes: explicit versioned consent, persistence before pipeline, legacy isolation, origin/owner gates, duplicate demo and claim-bound replay; fixtures only.');
