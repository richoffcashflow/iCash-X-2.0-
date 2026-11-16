import {signatureRequestMessage} from '../lib/signing-invitation.ts';
import {originalContractProfile,originalContractFieldsForRole} from '../lib/original-contracts.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {SigningDeadlineReviewError,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus} from '../lib/signing-policy.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {automationTick} from '../worker/runner.mjs';

// Exercise actual server send/auto-sign entry points with only in-memory database and provider fixtures.
let manualConsent=true;
let cancellationAfterSend=false,allowedReads=0,cancelledWriteBodies=0;
let formProfile='legacy',payload=null,tamperPrice=false,providerCompleted=false,providerFailure=false,statusSaveFailure=false,envelopeTestMode=true,notifications=0;
let now=Date.parse('2026-09-30T12:00:00Z'),advanceBeforeSend=false,advanceAfterAutoClaim=false,records=[],providerWrites=0,autoClaims=0;
let terms=dealTermsSchema.parse({seller:'Fixture seller',buyer:'Fixture principal',address:'Fixture only',legalDescription:'Fixture lot',state:'TX',priceCents:100000,priceSource:'seller_reported',earnestCents:0,closingDate:'2026-10-02'});
const recipients=[{id:'1',email:'seller@example.invalid',name:'Fixture seller',placeholder_name:'Seller'},{id:'2',email:'customer@example.invalid',name:'Fixture principal',placeholder_name:'Customer'}];
const envelope=()=>({id:'envelope',account_id:'account',deal_id:'deal',terms,kind:'purchase',terms_hash:signingTermsHash(terms),template_id:'template',provider_id:'123',state:'awaiting_counterparty',test_mode:envelopeTestMode,recipients});
const template=()=>({form_profile:formProfile,id:'template',provider:'docuseal',provider_template_id:'123',placeholder_names:['Seller','Customer'],field_map:Object.fromEntries(Object.keys(signingFields(terms,'purchase',false,formProfile)).map(k=>[k,k])),test_mode:true,rate_id:null,reviewed_until:'2027-01-01T00:00:00Z',max_legal_description_chars:2000,automated_signing_reviewed:true,customer_signature_field:'signature',customer_consent_field:'consent'});
const db=async(path,method,body)=>{
 records.push({path,method,body});
 if(path.startsWith('icash_text_threads'))return [{id:'fixture-thread'}];
 if(path.startsWith('icash_text_suppressions'))return [];
 if(path==='rpc/icash_manual_signing_sms_current'){assert.equal(body.p_actor,'user');return manualConsent;}
 if(path==='rpc/icash_sms_thread_review_current')return false;
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture principal'}];
 if(path.startsWith('icash_signing_templates'))return [template()];
 if(path==='rpc/icash_begin_signing'){if(advanceBeforeSend)now=Date.parse('2026-10-04T12:00:00Z');return envelope();}
 if(path.startsWith('icash_signing_envelopes'))return method==='PATCH'?[]:[envelope()];
 if(path==='rpc/icash_signing_action_allowed')return !cancellationAfterSend||++allowedReads===1;
 if(path==='rpc/icash_claim_signing_poll')return true;
 if(path==='rpc/icash_save_signing_status'){if(statusSaveFailure)throw Error('Fixture status save failed');return null;}
 if(path==='rpc/icash_claim_auto_signature'){if(formProfile===originalContractProfile)return null;autoClaims++;if(advanceAfterAutoClaim)now=Date.parse('2026-10-04T12:00:00Z');return 'Fixture signature';}
 if(path==='icash_signature_authorizations')return null;
 throw Error('Unexpected fixture database call '+path);
};
const fixtureFetch=async(url,options)=>{
 assert(String(url).startsWith('https://api.docuseal.com/'));
 if(options.method==='PUT'){providerWrites++;return new Response(new ReadableStream({cancel(){cancelledWriteBodies++;}},{highWaterMark:0}));}
 if(options.method!=='GET'){providerWrites++;payload=JSON.parse(options.body);assert(!JSON.parse(options.body).submitters?.some(s=>s.fields.some(f=>f.name==='earnestCents')));return Response.json([{submission_id:123},{submission_id:123}]);}
 if(providerFailure)return new Response(null,{status:503});
 return Response.json({id:123,submitters_order:'preserved',completed_at:providerCompleted?'2026-09-30T13:00:00Z':null,submitters:recipients.map((r,index)=>({id:index+1,submission_id:123,email:r.email,external_id:`envelope:${r.id}`,status:index===0||providerCompleted?'completed':'awaiting',completed_at:index===0?'2026-09-30T12:00:00Z':providerCompleted?'2026-09-30T13:00:00Z':null,metadata:{terms_hash:signingTermsHash(terms)},values:Object.entries(signingFields(terms,'purchase',false,formProfile)).filter(([,value])=>formProfile!==originalContractProfile||value!=='').map(([field,value])=>({field,value:tamperPrice&&field==='priceCents'?'999.00':value})),slug:'fixture'}))});
};
globalThis.__signingValidationFixture={signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation:async(_i,send)=>send(),dispatchAttentionNotification:async()=>{notifications++;},dispatchCustomerUpdate:async()=>{notifications++;},SigningDeadlineReviewError,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema};
let source=ts.transpileModule(readFileSync(new URL('../lib/signing-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation,dispatchAttentionNotification,dispatchCustomerUpdate,SigningDeadlineReviewError,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema}=globalThis.__signingValidationFixture;\n'+source;
const {sendForSignatures,refreshSigning,customerSigningLink}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const oldFetch=globalThis.fetch,oldNow=Date.now,oldKey=process.env.DOCUSEAL_TEST_API_KEY,oldMode=process.env.DOCUSEAL_MODE,oldLiveKey=process.env.DOCUSEAL_API_KEY,oldLiveReady=process.env.ICASH_LIVE_WORK_READY;
globalThis.fetch=fixtureFetch;Date.now=()=>now;process.env.DOCUSEAL_TEST_API_KEY='fixture';process.env.DOCUSEAL_MODE='test';process.env.DOCUSEAL_API_KEY='fixture';process.env.ICASH_LIVE_WORK_READY='true';
const input={accountId:'account',userId:'user',customerEmail:'customer@example.invalid',dealId:'deal',kind:'purchase',signers:[{name:'Fixture seller',email:'seller@example.invalid'}],autoSignature:'Fixture signature'};
try{
 await sendForSignatures(input);assert.equal(providerWrites,1);
 const originalWrites=providerWrites;
 await assert.rejects(()=>sendForSignatures({...input,expectedTerms:{...terms,priceCents:terms.priceCents+100000}}),/confirmed terms changed/);
 assert.equal(providerWrites,originalWrites,'a human edit after automatic confirmation cannot be signed under the old confirmation');
 const phoneInput={...input,autoSignature:undefined,manualSend:true,signers:[{name:'Fixture seller',phone:'+12125550123',email:'seller@example.invalid'}]};
 providerWrites=0;await sendForSignatures(phoneInput);assert.equal(providerWrites,1,'manual send uses owner-bound consent while property automation is paused');
 assert.equal(payload.submitters[0].email,'seller@example.invalid');
 providerWrites=0;manualConsent=false;await assert.rejects(()=>sendForSignatures(phoneInput),/current text conversation/);assert.equal(providerWrites,0);manualConsent=true;
 await assert.rejects(()=>sendForSignatures({...phoneInput,manualSend:false}),/current text conversation/);assert.equal(providerWrites,0,'automatic sending does not inherit manual authorization');
 records=[];providerWrites=0;terms={...terms,earnestCents:null};
 await sendForSignatures(input);assert.equal(providerWrites,1,'missing seller EMD does not block signing');
 records=[];providerWrites=0;terms={...terms,legalDescription:''};
 await assert.rejects(()=>sendForSignatures(input),/legal description/);
 assert.equal(providerWrites,0);assert(!records.some(r=>r.path==='rpc/icash_begin_signing'));

 terms={...terms,legalDescription:'Fixture lot'};advanceBeforeSend=true;records=[];
 await assert.rejects(()=>sendForSignatures(input),/deadline has passed/);
 assert.equal(providerWrites,0,'deadline is checked again after the server claim, before provider dispatch');
 assert(!records.some(r=>r.path==='icash_signature_authorizations'),'no auto-sign authorization saved after final validation fails');
 assert(records.some(r=>r.method==='PATCH'&&r.body.state==='needs_review'));

 records=[];
 assert.equal((await refreshSigning('account','envelope')).status,'customer_signature_needed','verified pending receipt remains readable after its deadline');
 assert.equal(autoClaims,0,'expired agreement never claims automatic signature authority');
 assert.equal(providerWrites,0);
 assert(records.some(r=>r.path==='rpc/icash_save_signing_status'&&r.body.p_state==='customer_signature_needed'),'pending original receipt was saved');
 assert(!records.some(r=>r.method==='PATCH'),'polling does not move the envelope out of the original receipt selector');
 await assert.rejects(()=>customerSigningLink('account','envelope','customer@example.invalid'),/deadline has passed/);
 assert.equal(providerWrites,0);
 // Same-day ambiguity is the observed failure shape. Test both original and
 // legacy forms without real customer terms, dates, signatures or provider I/O.
 for(const profile of ['legacy',originalContractProfile])for(const testMode of [true,false]){
  formProfile=profile;envelopeTestMode=testMode;now=Date.parse('2026-10-02T15:00:00Z');records=[];
  assert.equal((await refreshSigning('account','envelope')).status,'customer_signature_needed');
  assert.equal(autoClaims,0,'known deadline review never consumes an existing or absent authorization');
  assert.equal(providerWrites,0);
  assert.equal(notifications,0,'deadline review does not start customer notifications');
  assert.equal(records.filter(r=>r.path==='rpc/icash_save_signing_status').length,1);
  assert.equal(records.at(-1).path,'rpc/icash_save_signing_status','no dispatch or authorization follows deadline review');
  await assert.rejects(()=>customerSigningLink('account','envelope','customer@example.invalid'),/deadline may be today/);
 }
 envelopeTestMode=true;
 // Compose actual refresh, route and worker dispatch: the ticket completes a
 // receipt poll, with its pending outcome preserved, not a contract signature.
 const token='00000000-0000-4000-8000-000000000001'.repeat(2),poll={state:'issued',outcome:null};
 const {POST}=await loadService('app/api/internal/automation/route.ts',{
  refreshSigning,automationWorkReady:()=>true,newLiveWorkKinds:new Set(),NextResponse:{json:Response.json},
  db:async(path,method,body)=>{
   if(path==='rpc/icash_consume_automation'){
    assert.equal(body.p_token,token);if(poll.state!=='issued')return null;poll.state='consumed';
    return {id:'fixture-poll',accountId:'account',kind:'signing_result',signingId:'envelope'};
   }
   if(path==='rpc/icash_finish_automation'){
    assert.equal(body.p_id,'fixture-poll');assert.equal(body.p_success,true);
    assert.equal(body.p_outcome,'customer_signature_needed');poll.state='complete';poll.outcome=body.p_outcome;return null;
   }
   throw Error('Unexpected automation fixture database call');
  },
 });
 const routeRequest=options=>new Request('https://fixture.invalid/api/internal/automation',options);
 assert.equal(await automationTick(async()=>({token}),async(_url,options)=>POST(routeRequest(options)),'recovery'),true);
 assert.deepEqual(poll,{state:'complete',outcome:'customer_signature_needed'});
 assert.equal((await POST(routeRequest({method:'POST',headers:{Authorization:'Bearer '+token}}))).status,401,'a completed receipt-poll capability cannot replay');
 assert.equal(autoClaims,0);assert.equal(providerWrites,0);
 assert.equal(notifications,0);
 tamperPrice=true;await assert.rejects(()=>refreshSigning('account','envelope'),/field values need review/);tamperPrice=false;
 providerFailure=true;await assert.rejects(()=>refreshSigning('account','envelope'),/provider request failed/);providerFailure=false;
 statusSaveFailure=true;await assert.rejects(()=>refreshSigning('account','envelope'),/Fixture status save failed/);statusSaveFailure=false;
 const savedClosingDate=terms.closingDate;terms={...terms,closingDate:''};
 await assert.rejects(()=>refreshSigning('account','envelope'),/Confirm the closing date/);terms={...terms,closingDate:savedClosingDate};
 providerCompleted=true;records=[];
 assert.equal((await refreshSigning('account','envelope')).status,'test_completed','later original completed evidence remains pollable after deadline review');
 assert(records.some(r=>r.path==='rpc/icash_save_signing_status'&&r.body.p_state==='test_completed'));
 assert.equal(autoClaims,0);assert.equal(providerWrites,0);providerCompleted=false;formProfile='legacy';
 now=Date.parse('2026-09-30T12:00:00Z');advanceAfterAutoClaim=true;
 await assert.rejects(()=>refreshSigning('account','envelope'),/deadline has passed/);
 assert.equal(autoClaims,1);assert.equal(providerWrites,0,'expiry after an authorization claim still prevents the final signature write');
 now=Date.parse('2026-09-30T12:00:00Z');advanceBeforeSend=false;advanceAfterAutoClaim=false;formProfile=originalContractProfile;records=[];providerWrites=0;
 await sendForSignatures({...input,autoSignature:undefined});assert.equal(providerWrites,1);
 assert(payload.submitters[0].fields.some(f=>f.name==='priceCents'&&f.default_value==='1000.00'));
 assert(payload.submitters[1].fields.some(f=>f.name==='buyerPrinted'&&f.default_value==='Fixture principal'));
 assert(!payload.submitters.flatMap(s=>s.fields).some(f=>/escrow|email|notes|consent/i.test(f.name)));
 assert.equal((await refreshSigning('account','envelope')).status,'customer_signature_needed','blank optional fields may be absent in provider readback');
 tamperPrice=true;await assert.rejects(()=>refreshSigning('account','envelope'),/field values need review/);
 tamperPrice=false;formProfile='legacy';cancelledWriteBodies=0;
 await refreshSigning('account','envelope');assert.equal(cancelledWriteBodies,1,'Successful signature write releases its unused response before canonical readback');
 cancellationAfterSend=true;allowedReads=0;
 await sendForSignatures({...input,autoSignature:undefined});assert.equal(cancelledWriteBodies,2,'Late cancellation releases its unused expire response');
}finally{
 globalThis.fetch=oldFetch;Date.now=oldNow;
 if(oldKey===undefined)delete process.env.DOCUSEAL_TEST_API_KEY;else process.env.DOCUSEAL_TEST_API_KEY=oldKey;
 if(oldMode===undefined)delete process.env.DOCUSEAL_MODE;else process.env.DOCUSEAL_MODE=oldMode;
 if(oldLiveKey===undefined)delete process.env.DOCUSEAL_API_KEY;else process.env.DOCUSEAL_API_KEY=oldLiveKey;
 if(oldLiveReady===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=oldLiveReady;
 delete globalThis.__signingValidationFixture;
}
console.log('Actual signing service: verified pending polls remain successful during deadline review; signing authority, field/save failures, final deadline checks and later original receipts remain enforced. All fixtures.');
