// Saved-call regression, anonymized. Real qualification, evidence, offer and
// agreement services; only persistence and external transports are simulated.
import assert from 'node:assert/strict';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';
import {sellerOfferQualification} from '../lib/seller-offer-qualification.ts';
import {sellerRoutineTimingAnswer} from '../lib/seller-timing-answer.ts';
import {sellerRoutineOwnershipAnswer} from '../lib/seller-ownership-answer.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {sellerPayoffEvidence} from '../lib/seller-payoff.ts';
import {sellerAgreementAction} from '../lib/seller-agreement-service.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const token='a'.repeat(64),now=Date.now(),conversationId='conv_replay';
for(const direction of ['inbound','outbound']){
 const history={transcript:[]},a=message=>history.transcript.push({role:'agent',message}),u=message=>history.transcript.push({role:'user',message});
 const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',legal_description:'Lot 1 Block 2',estimated_value:177000,estimated_repair_cost:28875,total_estimated_loan_balance:0,estimated_equity_percentage:100,num_total_active_liens:1}}};
 const current={party:'seller',accountId:'account',dealId:'deal',address:'45 Fixture Lane',snapshot,offerState:null,offerVersion:0};
 let terms=dealTermsSchema.parse({address:current.address,buyer:'Fixture Buyer',state:'TX',legalDescription:'Lot 1 Block 2'}),claim=null,envelopes=[],sends=0,texts=0;
 const deps={now:()=>now,bind:async()=>{},verifyQualification:async()=>sellerOfferQualification(history),resolveStatement:async i=>callSellerStatement(history,i),verifyInput:async i=>callOfferEvidence(history,i),verifyPayoffChange:async i=>callPayoffEvidence(history,i),verifySellerPrice:async i=>callSellerPriceEvidence(history,i),verifyListingStatus:async i=>sellerListingEvidence(history,i),verifyRoutineTimingAnswer:async i=>sellerRoutineTimingAnswer(history,i),verifyRoutineOwnershipAnswer:async i=>sellerRoutineOwnershipAnswer(history,i),verifyPayoffFacts:async i=>sellerPayoffEvidence(history,i),db:async(path,method,body)=>{
  if(path==='rpc/icash_call_offer_context')return structuredClone(current);
  if(path==='rpc/icash_save_call_offer'){
   assert.equal(body.p_expected_version,current.offerVersion);assert.deepEqual(body.p_expected_snapshot,snapshot);
   current.offerState=structuredClone(body.p_state);current.offerVersion++;return true;
  }
  if(path==='rpc/icash_seller_agreement_call_context')return {callKey:direction+':fixture',accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.invalid',dealId:'deal',screeningId:'screen',phone:'+12025550123'};
  if(path.startsWith('icash_signing_envelopes?'))return envelopes;
  if(path.startsWith('icash_deal_files?'))return [{terms,stage:'draft'}];
  if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
  if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture Buyer'}];
  if(path.startsWith('icash_text_threads?'))return [{id:'thread'}];
  if(path.startsWith('icash_text_suppressions?'))return [];
  if(path==='rpc/icash_sms_thread_review_current')return true;
  if(path==='rpc/icash_claim_seller_agreement'){
   if(claim)return {...claim,claimed:false};
   terms=body.p_terms;claim={id:'claim',claimed:true,envelopeId:null};return claim;
  }
  if(path==='rpc/icash_finish_seller_agreement'){claim.envelopeId=body.p_envelope;return true;}
  assert.fail(path);
 }};
 const call=async input=>{
  const result=await automaticCallOffer(token,{conversationId,...input},deps);
  history.transcript.push({role:'agent',tool_results:[{tool_name:'icash_offer_and_contract',is_error:false,result_value:JSON.stringify(result)}]});
  return result;
 };
 a('Is this the owner of 45 Fixture Lane?');u('Yes.');
 a('Would you consider a cash sale?');u('Yes. How much can you give me?');
 a('What has you thinking about selling?');u('I want to move out. I have been having problems and going broke.');
 a('What repairs or updates does the property need?');u("It needs a new roof. I don't live in there right now, so everything is gutted.");
 const early=await call({action:'update_repairs',sellerStatement:'Needs a roof and gutted.',repairEstimateCents:null});
 assert.equal(early.quoteAllowed,false,'incomplete qualification cannot expose a price');
 assert.equal(current.offerState.quotedPriceCents,8500000);
 a('Is anyone living in the property?');u('No one.');
 a('When are you hoping to sell?');u("I'm looking to sell within the next 30 to 60 days.");
 await call({action:'report_change',sellerStatement:'30 to 60 days.'});
 assert.notEqual(current.offerState.factsPending,true,'the failed real call must no longer erase its quote');
 a('Is the property currently listed with a real estate agent?');u('No.');
 await call({action:'report_change',sellerStatement:'No.'});
 a('Are there any other owners who need to agree to the sale?');u('No.');
 await call({action:'report_change',sellerStatement:'No.'});
 let quote=await call({action:'get_offer'});
 assert.equal(quote.quoteAllowed,true);assert.equal(quote.priceCents,8500000);assert.equal(quote.contractAllowed,false);
 a(quote.spokenOffer);u('What else do you need?');
 a('What is the current mortgage payoff balance?');u('It is paid off.');
 quote=await call({action:'report_change',sellerStatement:'It is paid off.'});
 assert.equal(quote.contractAllowed,false,'a lien flag still needs the other-debt answer');
 a('Are there any other loans, liens, unpaid taxes or HOA balances besides that mortgage?');u('No.');
 quote=await call({action:'report_change',sellerStatement:'No.'});
 assert.equal(quote.contractAllowed,true);assert.equal(quote.priceCents,8500000);assert.equal(quote.payoffVerified,false);
 a('We can offer $85,000 cash, as is. Does that work?');u('Yes.');
 const accepted=await call({action:'accept_offer',priceCents:quote.priceCents,quoteRevision:quote.quoteRevision});
 assert.equal(accepted.status,'verbally_accepted');
 const closingDate=new Date(now+30*86400000).toISOString().slice(0,10);
 a('What is your full legal name for the agreement?');u('Jane Seller.');
 a('Are you the only owner and decision maker?');u('Yes, just me.');
 a(`The purchase price is $85,000 cash, closing ${closingDate} with a ten-day inspection period. May I text the agreement now?`);u('Yes, please.');
 const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:8500000,closingDate,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
 const agreementDeps={...deps,history:async()=>history,refresh:async()=>assert.fail('No polling signatures before sending'),send:async input=>{
  sends++;assert.equal(input.phoneLinkOnly,true);assert.equal(input.expectedTerms.priceCents,8500000);assert.equal(input.expectedTerms.closingDate,closingDate);
  envelopes=[{id:'fixture-envelope',state:'awaiting_counterparty',test_mode:false,terms,recipients:[{id:'seller',name:'Jane Seller',phone:'+12025550123'},{id:'buyer',name:'Fixture Buyer'}]}];return {id:'fixture-envelope',testMode:false};
 },text:async(account,envelope,phone)=>{texts++;assert.deepEqual([account,envelope,phone],['account','fixture-envelope','+12025550123']);return {sent:true,status:'accepted',instruction:'Provider accepted the text.'};}};
 const result=await sellerAgreementAction(token,{action:'confirm_and_send',conversationId,confirmation},agreementDeps);
 assert.equal(result.sent,true);assert.equal(result.status,'accepted');assert.equal(sends,1);assert.equal(texts,1);
 await sellerAgreementAction(token,{action:'confirm_and_send',conversationId,confirmation},agreementDeps);
 assert.equal(sends,1,'repeated tool execution reuses the same agreement');
 assert.equal(snapshot.raw.data.num_total_active_liens,1,'seller answers never rewrite original title research');
}
console.log('PASS saved-call replay through qualification, source-bound timing/listing/ownership, conditional quote, payoff answers, exact acceptance, one final readback and one agreement; inbound and outbound, provider tool receipts retained. No external contacts.');
