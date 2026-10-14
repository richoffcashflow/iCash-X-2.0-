import assert from 'node:assert/strict';
import {sellerAgreementAction} from '../lib/seller-agreement-service.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';

const now=Date.now(),closingDate=new Date(now+14*86400000).toISOString().slice(0,10);
const initial=dealTermsSchema.parse({address:'45 Fixture Lane',buyer:'Fixture Buyer',state:'TX',legalDescription:'Lot 1 Block 2'});
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:9000000,closingDate,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:initial.address,legal_description:initial.legalDescription,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const scope={callKey:'outbound:fixture',accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12125550199'};
const history={transcript:[
 {role:'agent',message:'What is your full legal name for the agreement?'},{role:'user',message:'Jane Seller.'},
 {role:'agent',message:'Are you the only owner and decision maker?'},{role:'user',message:'Yes, just me.'},
 {role:'agent',message:`The purchase price is $90000 cash, closing ${closingDate} with a ten-day inspection period. May I text the agreement now?`},{role:'user',message:'Yes, please.'},
]};
const confirmed=dealTermsSchema.parse({...initial,earnestCents:null,seller:confirmation.sellerLegalName,priceCents:confirmation.agreedPriceCents,priceSource:'seller_reported',closingDate});
let threads=[],reviewCurrent=false,suppressed=false,claims=0,sends=0,texts=0,gaps=0,claim=null,envelopes=[],terms=initial;
let deferMode='none',deferrals=0,queueRows=0,queued=false,sendError=null,uncertainProvider=false;
const deps={now:()=>now,bind:async()=>{},history:async()=>history,refresh:async()=>assert.fail('Sending does not poll signatures'),
 db:async(path,method,body)=>{
  if(path==='rpc/icash_seller_agreement_call_context')return scope;
  if(path==='rpc/icash_call_offer_context')return null;
  if(path.startsWith('icash_signing_envelopes?'))return envelopes;
  if(path.startsWith('icash_deal_files?'))return [{terms,stage:'draft'}];
  if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
  if(path.startsWith('icash_customer_identities?'))return [{principal:initial.buyer}];
  if(path.startsWith('icash_text_threads?')){
   assert.match(path,/account_id=eq.account&deal_id=eq.deal&recipient=eq.%2B12125550199&party=eq.seller&retired_at=is.null&paused=eq.false&manual_only=eq.false&/);
   return threads;
  }
  if(path.startsWith('icash_text_suppressions?'))return suppressed?[{phone:scope.phone}]:[];
  if(path==='rpc/icash_sms_thread_review_current'){
   assert.deepEqual(body,{p_account:'account',p_thread:'thread',p_check_hour:true});return reviewCurrent;
  }
  if(path==='rpc/icash_record_seller_tool_gap'){
   assert.equal(body.p_conversation,'conv_fixture');assert.equal(body.p_reason,'agreement_text_unavailable');assert.match(body.p_hash,/^[a-f0-9]{64}$/);
   gaps++;return 'durable-case';
  }
  if(path==='rpc/icash_defer_seller_agreement'){
   deferrals++;assert.equal(body.p_conversation,'conv_fixture');assert.match(body.p_hash,/^[a-f0-9]{64}$/);
   assert.deepEqual(body.p_confirmation,confirmation);assert.deepEqual(body.p_terms,confirmed);
   assert([initial,terms].some(value=>JSON.stringify(value)===JSON.stringify(body.p_expected_terms)),'The expected terms come from the current bound deal read');
   if(deferMode==='throw')throw Error('Queue unavailable');
   if(deferMode==='none'||envelopes.length)return null;
   if(!queued){queued=true;queueRows++;terms=body.p_terms;claim??={id:'confirmation',claimed:true,envelopeId:null};}
   return {queued:true,id:'same-recovery'};
  }
  if(path==='rpc/icash_claim_seller_agreement'){
   claims++;if(claim)return {...claim,claimed:false};
   terms=body.p_terms;claim={id:'confirmation',claimed:true,envelopeId:null};return claim;
  }
  if(path==='rpc/icash_finish_seller_agreement'){claim.envelopeId=body.p_envelope;return true;}
  if(path==='rpc/icash_fail_seller_agreement')return null;
  assert.fail(path);
 },
 send:async input=>{
  sends++;assert.equal(input.phoneLinkOnly,true);
  if(sendError){if(uncertainProvider)envelopes=[{id:'uncertain-envelope',state:'needs_review'}];throw sendError;}
  envelopes=[{id:'envelope',state:'awaiting_counterparty',test_mode:false,terms,recipients:[{id:'1',name:confirmation.sellerLegalName,phone:scope.phone},{id:'2',name:initial.buyer}]}];
  return {id:'envelope',testMode:false};
 },
 text:async(account,id,phone)=>{texts++;assert.deepEqual([account,id,phone],['account','envelope',scope.phone]);return {sent:true,status:'accepted',instruction:'Provider accepted the text.'};},
};
const send=()=>sellerAgreementAction('a'.repeat(64),{action:'confirm_and_send',conversationId:'conv_fixture',confirmation},deps);
const assertUnspent=()=>{assert.equal(claims,0);assert.equal(sends,0);assert.equal(texts,0);assert.deepEqual(terms,initial);};
let result=await send();assert.equal(result.status,'delivery_unavailable');assert.equal(result.reason,'agreement_text_unavailable');assertUnspent();assert.equal(gaps,1);
threads=[{id:'thread'}];result=await send();assert.equal(result.status,'delivery_unavailable');assertUnspent();assert.equal(gaps,2);
reviewCurrent=true;threads.push({id:'duplicate-thread'});result=await send();assert.equal(result.status,'delivery_unavailable');assertUnspent();assert.equal(gaps,3);
threads.pop();suppressed=true;result=await send();assert.equal(result.reason,'contact_stopped');assertUnspent();assert.equal(gaps,3,'Opt-out is not an invitation to retry delivery');

// Restoring the permitted channel can use the same seller answers. Earlier
// setup failures did not spend the claim or leave a half-created envelope.
suppressed=false;result=await send();assert.equal(result.sent,true);assert.equal(claims,1);assert.equal(sends,1);assert.equal(texts,1);
assert.equal(terms.priceCents,confirmation.agreedPriceCents);assert.equal(terms.closingDate,closingDate);
result=await send();assert.equal(result.sent,true);assert.equal(sends,1,'A retry reuses the existing envelope');assert.equal(texts,2);

// Fully confirmed requests can wait durably for a permitted text channel. The
// database owns one queue row and claim, and repeated tool calls reuse both.
const reset=()=>{threads=[];reviewCurrent=false;suppressed=false;claims=sends=texts=gaps=deferrals=queueRows=0;claim=null;envelopes=[];terms=initial;queued=false;sendError=null;uncertainProvider=false;deferMode='queue';};
reset();result=await send();assert.equal(result.status,'delivery_queued');assert.equal(result.sent,false);assert.equal(result.deliveryScheduled,true);assert.equal(queueRows,1);assert.equal(sends,0);assert.equal(gaps,0);
result=await send();assert.equal(result.status,'delivery_queued');assert.equal(queueRows,1);assert.equal(deferrals,2);
threads=[{id:'thread'}];reviewCurrent=true;
result=await send();assert.equal(result.status,'delivery_queued');assert.equal(queueRows,1);assert.equal(sends,0,'Restored texting waits for the already queued worker instead of creating a second agreement');
const beforeInvalid=deferrals;
history.transcript.at(-1).message='No, not yet.';result=await send();assert.equal(result.status,'confirmation_needed');assert.equal(deferrals,beforeInvalid,'Missing spoken text permission never reaches the queue');
history.transcript.at(-1).message='Yes, please.';
await assert.rejects(sellerAgreementAction('a'.repeat(64),{action:'confirm_and_send',conversationId:'conv_fixture',confirmation:{...confirmation,sendTextRequested:false}},deps),/confirmation_required/);
assert.equal(deferrals,beforeInvalid,'A false confirmation flag never reaches the queue');
suppressed=true;result=await send();assert.equal(result.reason,'contact_stopped');assert.equal(deferrals,beforeInvalid,'Suppression never queues or re-arms delivery');suppressed=false;
// Simulate the worker creating the single exact envelope. The next call reuses it.
await deps.send({phoneLinkOnly:true});claim.envelopeId='envelope';result=await send();
assert.equal(result.sent,true);assert.equal(sends,1);assert.equal(texts,1);assert.equal(queueRows,1);

// A deterministic pre-creation outage can defer after the claim. An uncertain
// provider attempt has an envelope and must never create a new queued attempt.
reset();threads=[{id:'thread'}];reviewCurrent=true;sendError=Error('Text setup unavailable');
result=await send();assert.equal(result.status,'delivery_queued');assert.equal(queueRows,1);assert.equal(envelopes.length,0);assert.equal(texts,0);
reset();threads=[{id:'thread'}];reviewCurrent=true;sendError=Error('Provider outcome unknown');uncertainProvider=true;
await assert.rejects(send(),/Provider outcome unknown/);assert.equal(queueRows,0);assert.equal(texts,0);
reset();deferMode='throw';result=await send();assert.equal(result.status,'delivery_unavailable');assert.equal(result.deliveryScheduled,undefined);assert.equal(gaps,1,'Queue failures preserve a truthful durable issue instead of claiming scheduled delivery');
console.log('PASS confirmed contracts queue once for automatic recovery; missing answers and stops never queue, restored delivery reuses one envelope, unknown provider outcomes are not replayed. No provider calls.');
