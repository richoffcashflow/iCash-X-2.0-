import assert from 'node:assert/strict';
import {recoverAgreementDelivery} from '../lib/agreement-delivery-recovery.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingTermsHash} from '../lib/signing-policy.ts';
const job={id:'job',accountId:'account',userId:'owner',customerEmail:'owner@example.test',dealId:'deal',phone:'+12125550199',sellerName:'Jane Seller',expectedTerms:{seller:'Jane Seller',buyer:'Fixture Buyer',address:'45 Fixture Lane',state:'TX',priceCents:4812800,priceSource:'seller_reported',closingDate:'2026-11-11'}};
const env={VERCEL_ENV:'production',DOCUSEAL_MODE:'live',ICASH_LIVE_WORK_READY:'true'};
let pending=true,existing=[],sends=0,texts=0,result,finishMode='ok',finishCalls=[];
const d={db:async(path,method,b)=>{
 if(path==='rpc/icash_reconcile_agreement_delivery_receipts')return 0;
 if(path==='rpc/icash_claim_agreement_delivery_recovery'){if(!pending)return null;pending=false;return job;}
 if(path.startsWith('icash_signing_envelopes?'))return existing;
 if(path==='rpc/icash_finish_agreement_delivery_recovery'){finishCalls.push(b);if(finishMode==='throw')throw Error('receipt storage unavailable');result=b;return finishMode!=='reject';}
 throw Error(path);
},send:async i=>{sends++;assert.equal(i.phoneLinkOnly,true);assert.equal(i.autoSignature,undefined);assert.deepEqual(i.expectedTerms,job.expectedTerms);assert.deepEqual(i.signers,[{name:job.sellerName,phone:job.phone}]);return {id:'envelope',testMode:false};},text:async(a,e,p)=>{texts++;assert.deepEqual([a,e,p],['account','envelope',job.phone]);return {sent:true,status:'accepted'};}};
assert.equal((await recoverAgreementDelivery(d,{...env,VERCEL_ENV:'preview'})).status,'disabled');assert.equal(pending,true);
assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_text_accepted');assert.equal(result.p_result.sent,true);
assert.equal((await recoverAgreementDelivery(d,env)).status,'idle');assert.equal(sends,1);assert.equal(texts,1);
pending=true;existing=[{id:'envelope',state:'needs_review'}];assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_recovery_needs_review');assert.equal(sends,1,'uncertain provider creation cannot be replayed');
pending=true;existing=[{id:'envelope',state:'awaiting_counterparty',provider_id:'1',terms:job.expectedTerms,recipients:[{name:job.sellerName,phone:job.phone},{name:'Fixture Buyer'}]}];
assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_text_accepted');assert.equal(sends,1,'matching envelope is reused');
pending=true;existing[0].recipients[0].phone='+12125550999';assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_recovery_needs_review');assert.equal(texts,2,'wrong recipient cannot receive the agreement');
existing[0].recipients[0].phone=job.phone;
for(const mode of ['reject','throw']){
 pending=true;finishMode=mode;finishCalls=[];
 const recovery=await recoverAgreementDelivery(d,env);
 assert.equal(recovery.status,'agreement_delivery_record_pending','An unsaved receipt cannot be called a completed recovery');
 assert.equal(finishCalls.length,1,'A storage failure must not overwrite an accepted text with a failed-delivery result');
 assert.deepEqual(finishCalls[0].p_result,{sent:true,status:'accepted'});
 assert.equal(sends,1,'Receipt failure cannot create another envelope');
}
// The dispatch result itself can be lost after its provider receipt is durable.
// It must remain eligible for receipt reconciliation, without another send.
let lostResponseState='queued',durableReceipt=false,lostResponseSends=0,lostResponseTexts=0,lostResponseFinishes=0;
const lostResponse={
 db:async path=>{
  if(path==='rpc/icash_reconcile_agreement_delivery_receipts'){
   if(lostResponseState==='claimed'&&durableReceipt){lostResponseState='sent';return 1;}
   return 0;
  }
  if(path==='rpc/icash_claim_agreement_delivery_recovery'){
   if(lostResponseState!=='queued')return null;
   lostResponseState='claimed';return job;
  }
  if(path.startsWith('icash_signing_envelopes?'))return [];
  if(path==='rpc/icash_finish_agreement_delivery_recovery'){
   lostResponseFinishes++;lostResponseState='needs_review';return true;
  }
  throw Error(path);
 },
 send:async()=>{lostResponseSends++;return {id:'envelope',testMode:false};},
 text:async()=>{lostResponseTexts++;durableReceipt=true;throw Error('Dispatch receipt response lost');},
};
assert.equal((await recoverAgreementDelivery(lostResponse,env)).status,'agreement_delivery_record_pending');
assert.equal(lostResponseState,'claimed');assert.equal(lostResponseFinishes,0,'Do not replace unknown text outcome with a definite failure');
assert.equal((await recoverAgreementDelivery(lostResponse,env)).status,'agreement_delivery_reconciled');
assert.equal(lostResponseState,'sent');assert.equal(lostResponseSends,1);assert.equal(lostResponseTexts,1,'Reconciliation must not resend');

// An unrelated receipt failure cannot strand another authorized agreement.
for(const stage of ['awaiting_counterparty','customer_signature_needed','completed']){
 let claimOpen=true,providerSends=0,originalTexts=0;
 const claimed={...job,existingEnvelopes:[{...existing[0],state:stage}]};
 const db=async path=>{
  if(path==='rpc/icash_reconcile_agreement_delivery_receipts')throw Error('Original receipt read unavailable');
  if(path==='rpc/icash_claim_agreement_delivery_recovery'){if(!claimOpen)return null;claimOpen=false;return claimed;}
  if(path==='rpc/icash_finish_agreement_delivery_recovery')return true;
  assert.fail('An atomic envelope read should not need a second lookup: '+path);
 };
 const deps={db,send:async()=>{providerSends++;throw Error('Unexpected duplicate');},text:async()=>{originalTexts++;return {sent:true,status:'accepted'};}};
 const outcome=await recoverAgreementDelivery(deps,env);
 assert.equal(outcome.status,stage==='awaiting_counterparty'?'agreement_text_accepted':'agreement_delivery_record_pending');
 assert.equal(outcome.receiptCheckFailed,true);assert.equal(providerSends,0);assert.equal(originalTexts,stage==='awaiting_counterparty'?1:0);
 assert.deepEqual(await recoverAgreementDelivery(deps,env),{status:'agreement_receipt_check_pending',receiptCheckFailed:true});
}

// Exercise the real signing entry point when the current deal changes after
// recovery consumed its one-use confirmation. No template/envelope/provider
// access may occur for terms the seller did not confirm.
const savedKey=process.env.DOCUSEAL_API_KEY;
process.env.DOCUSEAL_API_KEY='offline-fixture';
try{
 for(const change of [{priceCents:5000000},{closingDate:'2099-12-01'},{seller:'Different Seller'},{inspectionDays:4}]){
  let claimed=false,finished=null;const reads=[];
  const db=async(path,_method,body)=>{
   reads.push(path);
   if(path==='rpc/icash_reconcile_agreement_delivery_receipts')return 0;
   if(path==='rpc/icash_claim_agreement_delivery_recovery'){if(claimed)return null;claimed=true;return job;}
   if(path.startsWith('icash_signing_envelopes?'))return [];
   if(path.startsWith('icash_deal_files?'))return [{terms:{...job.expectedTerms,...change},stage:'draft'}];
   if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture Buyer'}];
   if(path==='rpc/icash_finish_agreement_delivery_recovery'){finished=body;return true;}
   assert.fail('Changed confirmation reached signing setup: '+path);
  };
  const {sendForSignatures}=await loadService('lib/signing-service.ts',{db,dealTermsSchema,signingTermsHash});
  const changed={db,send:sendForSignatures,text:async()=>assert.fail('Changed terms cannot be texted')};
  assert.equal((await recoverAgreementDelivery(changed,env)).status,'agreement_recovery_needs_review');
  assert.match(finished.p_result.reason,/confirmed terms changed/);
  assert.equal(reads.filter(path=>path==='rpc/icash_begin_signing').length,0);
  assert.equal((await recoverAgreementDelivery(changed,env)).status,'idle','The original claim is not replayed');
 }
 for(const expectedTerms of [undefined,null,[],{}]){
  let finished=null;
  const db=async(path,_method,body)=>{
   if(path==='rpc/icash_reconcile_agreement_delivery_receipts')return 0;
   if(path==='rpc/icash_claim_agreement_delivery_recovery')return {...job,expectedTerms};
   if(path.startsWith('icash_signing_envelopes?'))return [];
   if(path==='rpc/icash_finish_agreement_delivery_recovery'){finished=body;return true;}
   assert.fail(path);
  };
  assert.equal((await recoverAgreementDelivery({db,send:async()=>assert.fail('Missing confirmed snapshot cannot create an agreement'),text:async()=>assert.fail('No text')},env)).status,'agreement_recovery_needs_review');
  assert.equal(finished.p_result.reason,'Agreement terms snapshot required');
 }
}finally{if(savedKey===undefined)delete process.env.DOCUSEAL_API_KEY;else process.env.DOCUSEAL_API_KEY=savedKey;}
console.log('PASS explicit-owner agreement recovery, exact recipient and terms, no auto-signature, one provider request and safe uncertain-send handling.');
