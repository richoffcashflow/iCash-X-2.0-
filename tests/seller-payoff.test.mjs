import assert from 'node:assert/strict';
import {sellerPayoffEvidence,sellerPayoffPosition} from '../lib/seller-payoff.ts';
import {automaticCallOffer,calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {sellerAgreementAction} from '../lib/seller-agreement-service.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {callOfferEvidence,callPayoffEvidence} from '../lib/call-offer-evidence.ts';
import {automaticOfferReceptionPrompt,sellerAgreementReceptionVariables,streamingAutomaticOfferReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';

const now=Date.now(),address='45 Fixture Lane',token='a'.repeat(64),conversationId='conv_payoff';
// Reproduces the owner's $86,075 offer with a provider lien flag and a $50k payoff.
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:address,legal_description:'Lot 1 Block 2',estimated_value:150000,estimated_repair_cost:12750,total_estimated_loan_balance:0,estimated_equity_percentage:100,num_total_active_liens:1}}};
const base={party:'seller',accountId:'account',dealId:'deal',address,snapshot,offerState:null,offerVersion:0};
let current=structuredClone(base),transcript=[];
const evidence=(previous,latest,requested=latest)=>sellerPayoffEvidence({transcript:[{role:'agent',message:previous},{role:'user',message:latest}]},{action:'report_change',sellerStatement:requested});
const payoffQuestion='What is the current mortgage payoff balance?';
assert.deepEqual(evidence(payoffQuestion,'Uh, the current mortgage payoff is 50K.','The mortgage is fifty thousand dollars.'),{mortgageCents:5000000});
assert.equal(evidence(payoffQuestion,'Not 50K, I owe 70K.','50K'),null);
assert.equal(evidence(payoffQuestion,'I do not know.','50K'),null);
assert.equal(evidence('What repairs are needed?','50K'),null);
assert.equal(evidence(payoffQuestion,'The other owner owes 50K.'),null);
assert.deepEqual(evidence('Are there any other liens besides the mortgage?','But you can send it. That’s the only debt, but it still works. Can you send a contract?'),{otherDebtCents:0});
assert.deepEqual(evidence(payoffQuestion,'It is paid off.'),{mortgageCents:0});
assert.deepEqual(evidence('Are there any other liens besides the mortgage?','10K'),{otherDebtCents:1000000});
assert.equal(evidence(payoffQuestion,'It is not paid off.'),null);
const dependencies={now:()=>now,bind:async()=>{},verifyInput:async i=>callOfferEvidence({transcript},i),verifyPayoffChange:async i=>callPayoffEvidence({transcript},i),verifyPayoffFacts:async i=>sellerPayoffEvidence({transcript},i),db:async(path,method,body)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(current);
 assert.equal(path,'rpc/icash_save_call_offer');assert.equal(body.p_expected_version,current.offerVersion);
 current.offerState=structuredClone(body.p_state);current.offerVersion++;return true;
}};
const call=i=>automaticCallOffer(token,{conversationId,...i},dependencies);
const report=async(question,answer,argument=answer)=>{transcript=[{role:'agent',message:question},{role:'user',message:answer}];return call({action:'report_change',sellerStatement:argument});};
assert.equal((await call({action:'get_offer'})).priceCents,8607500);
let quote=await report(payoffQuestion,'Uh, the current mortgage payoff is 50K.','My mortgage payoff is $50,000.');
assert.equal(quote.priceCents,8607500);assert.equal(quote.contractAllowed,false);assert.match(quote.nextQuestion,/other loans/);
quote=await report(quote.nextQuestion,'No');
assert.equal(quote.contractAllowed,true);assert.equal(quote.payoffVerified,false);assert.equal(quote.titleVerificationRequiredBeforeClosing,true);
assert.equal(quote.reportedPayoff.shortfallCents,0);assert.equal(current.offerState.factsPending,false);
assert.equal(current.snapshot.raw.data.total_estimated_loan_balance,0,'original provider research is never rewritten');
transcript=[{role:'agent',message:'We can offer $86,075 cash, as is. Does that work?'},{role:'user',message:'Yes'}];
assert.equal((await call({action:'accept_offer',priceCents:quote.priceCents,quoteRevision:quote.quoteRevision})).status,'verbally_accepted');
assert.equal((await call({action:'get_offer'})).contractAllowed,true,'return call retains the grounded payoff');
const accepted=structuredClone(current);
quote=await report(payoffQuestion,'I do not know.');
assert.equal(quote.contractAllowed,false);
assert.equal(current.offerState.payoffPending,true);
quote=await report(payoffQuestion,'My mortgage is $50,000.');
assert.equal(quote.contractAllowed,true,'clarifying a balance clears only the debt question, not an ownership hold');

quote=await report(payoffQuestion,'My mortgage is $100,000.');
assert.equal(quote.priceCents,8607500);assert.equal(quote.contractAllowed,false);assert.equal(quote.reportedPayoff.shortfallCents,1392500);
assert.match(quote.nextQuestion,/\$13,925/);
assert.equal(evidence(quote.nextQuestion,'Yes, if the lender forgives it.'),null);
let declined=await report(quote.nextQuestion,'No, I cannot bring money.');
assert.equal(declined.contractAllowed,false);assert.match(declined.nextQuestion,/person/);
quote=await report(quote.nextQuestion,'Yes, I can bring that amount to closing.');
assert.equal(quote.contractAllowed,true);assert.equal(quote.reportedPayoff.shortfallCents,1392500);
quote=await report(payoffQuestion,'The actual payoff is $120,000.');
assert.equal(quote.contractAllowed,false,'a larger debt invalidates old willingness');
assert.equal(sellerPayoffPosition({mortgageCents:8607500,otherDebtCents:0},8607500).canProceed,true,'equal payoff is not a negative-equity rejection');
assert.equal(sellerPayoffPosition({mortgageCents:8000000,otherDebtCents:1000000},8607500).shortfallCents,392500);
await report('Has ownership changed?','There is another owner.');
assert.equal((await report(payoffQuestion,'My mortgage is $50,000.')).quoteAllowed,false,'payoff cannot clear an ownership change');

// Exercise the actual agreement service with the old provider lien hold still present.
current=accepted;
const terms=dealTermsSchema.parse({address,buyer:'Fixture Buyer',state:'TX',legalDescription:'Lot 1 Block 2'});
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:8607500,closingDate:new Date(now+14*86400000).toISOString().slice(0,10),soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
let sends=0,claimedTerms;
const signing={now:()=>now,bind:async()=>{},db:async(path,method,body)=>{
 if(path==='rpc/icash_seller_agreement_call_context')return {accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12025550142',callKey:'outbound:fixture'};
 if(path==='rpc/icash_call_offer_context')return current;
 if(path.startsWith('icash_signing_envelopes?'))return [];
 if(path.startsWith('icash_deal_files?'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
 if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture Buyer'}];
 if(path==='rpc/icash_claim_seller_agreement'){claimedTerms=body.p_terms;return {id:'claim',claimed:true,envelopeId:null};}
 if(path==='rpc/icash_finish_seller_agreement')return true;
 throw Error(path);
},send:async()=>{sends++;return {id:'fixture-envelope',testMode:false};},text:async()=>({sent:true,status:'accepted',instruction:'Provider accepted.'}),refresh:async()=>({status:'signature_pending'})};
assert.equal((await sellerAgreementAction(token,{action:'confirm_and_send',conversationId,confirmation},signing)).sent,true);
assert.equal(sends,1);assert.equal(claimedTerms.priceCents,8607500);assert.equal(claimedTerms.earnestCents,null);
current.offerState.payoffReport={mortgageCents:10000000,otherDebtCents:0};
await assert.rejects(sellerAgreementAction(token,{action:'confirm_and_send',conversationId,confirmation},signing),/updated_property_review_required/);
assert.equal(sends,1,'uncovered shortfall never reaches signing');
assert.match(automaticOfferReceptionPrompt,/I'm a cash buyer/);
for(const companyName of ['Clear Path Homes','',undefined]){
 const vars=sellerAgreementReceptionVariables({status:'matched',address,companyName},now);
 assert.equal(JSON.parse(vars.icash_property_context).companyName,companyName||null);
}
assert.equal(streamingAutomaticOfferReceptionPolicyHash,'9d85859a38887d32e5c91912bf897d23ff3cc78c26dc83de22599686b1deee96');
console.log('PASS seller payoff: actual-call regression, exact and paraphrased evidence, below/equal/above offer, shortfall yes/no, changed debts, ownership hold, company identity and complete mocked contract handoff. No external contacts.');
