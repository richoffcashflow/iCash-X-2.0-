import assert from 'node:assert/strict';
import {sellerAgreementAction} from '../lib/seller-agreement-service.ts';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';

const now=Date.now(),token='a'.repeat(64),conversationId='conv_calculated';
const scope={callKey:'outbound:fixture',accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12125550199'};
const initial=dealTermsSchema.parse({address:'45 Fixture Lane',buyer:'Fixture Buyer',state:'TX',legalDescription:'Lot 1 Block 2'});
const baseSnapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:initial.address,legal_description:initial.legalDescription,estimated_value:200000,estimated_repair_cost:null,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:9000000,closingDate:new Date(now+30*86400000).toISOString().slice(0,10),soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'yes',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
const history={transcript:[
 {role:'agent',message:'What is your full legal name for the agreement?'},{role:'user',message:'Jane Seller.'},
 {role:'agent',message:'Are you the only owner and decision maker?'},{role:'user',message:'Yes, just me.'},
 {role:'agent',message:`The price is $90,000 cash, closing ${confirmation.closingDate}, with a ten-day inspection period. May I text the agreement now?`},{role:'user',message:'Yes, please.'},
]};
let context,snapshot,terms,sends,texts,claims,envelopes;
function reset(){
 snapshot=structuredClone(baseSnapshot);terms=structuredClone(initial);sends=texts=claims=0;envelopes=[];
 context={...scope,party:'seller',address:initial.address,snapshot:structuredClone(snapshot),terms:structuredClone(terms),offerState:{repairEstimateCents:4000000,payoffReport:{mortgageCents:2000000,otherDebtCents:0},acceptedPriceCents:9000000}};
}
const deps={now:()=>now,bind:async()=>{},history:async()=>history,refresh:async()=>assert.fail('No signature polling'),db:async(path,method,body)=>{
 if(path==='rpc/icash_seller_agreement_call_context')return scope;
 if(path==='rpc/icash_call_offer_context')return context;
 if(path.startsWith('icash_signing_envelopes?'))return envelopes;
 if(path.startsWith('icash_deal_files?'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
 if(path.startsWith('icash_customer_identities?'))return [{principal:initial.buyer}];
 if(path.startsWith('icash_text_threads?'))return [{id:'thread'}];
 if(path.startsWith('icash_text_suppressions?'))return [];
 if(path==='rpc/icash_sms_thread_review_current')return true;
 if(path==='rpc/icash_claim_seller_agreement'){claims++;terms=body.p_terms;return {id:'claim',claimed:true,envelopeId:null};}
 if(path==='rpc/icash_finish_seller_agreement')return true;
 assert.fail(path);
},send:async input=>{sends++;assert.deepEqual(input.expectedTerms,terms);assert.deepEqual(input.signers,[{name:confirmation.sellerLegalName,phone:scope.phone}]);return {id:'envelope',testMode:false};},text:async()=>{texts++;return {sent:true,status:'accepted',instruction:'Provider accepted.'};}};
const send=(changes={})=>sellerAgreementAction(token,{action:'confirm_and_send',conversationId,confirmation:{...confirmation,...changes}},deps);
const blocked=async(label)=>{await assert.rejects(send(),/updated_property_review_required|price_review_required|INVALID_SNAPSHOT/,label);assert.equal(claims,0,label);assert.equal(sends,0,label);assert.equal(texts,0,label);};

reset();const quoted=calculateAutomaticCallOffer(context,context.offerState,now);
assert.equal(quoted.contractAllowed,true);assert.equal(quoted.status,'verbally_accepted');assert.equal(quoted.priceCents,confirmation.agreedPriceCents);
assert.equal((await send()).sent,true,'the same current accepted calculation reaches agreement preparation when provider repairs were missing');
assert.equal(sends,1);assert.equal(texts,1);assert.equal(terms.priceCents,confirmation.agreedPriceCents);assert.equal(snapshot.raw.data.estimated_repair_cost,null,'seller repairs never rewrite provider evidence');
for(const field of ['accountId','dealId','screeningId','phone']){
 reset();context[field]='different';await blocked(`mismatched ${field}`);
 reset();delete context[field];await blocked(`missing ${field}`);
}
reset();snapshot.raw.data.estimated_value=190000;await blocked('a changed current snapshot cannot use the earlier quote');
reset();context.snapshot.fetchedAt=new Date(now-86400001).toISOString();snapshot=structuredClone(context.snapshot);await blocked('stale matching research');
reset();context.offerState.repairEstimateCents=5000000;await blocked('increased seller repairs no longer support the accepted price');
reset();context.snapshot.raw.data.estimated_repair_cost=50000;snapshot=structuredClone(context.snapshot);await blocked('provider repair estimate remains the minimum');
reset();context.offerState.payoffReport={mortgageCents:10000000,otherDebtCents:0};await blocked('uncovered debt');
for(const field of ['factsPending','conditionPending','payoffPending','agreementRevisionRequired','acceptanceConditional']){reset();context.offerState[field]=true;await blocked(field);}
reset();context.offerState.acceptedPriceCents=null;await blocked('a quote is not accepted terms');
reset();delete context.offerState.repairEstimateCents;context.pendingAgreement={priceCents:9000000,closingDate:confirmation.closingDate};await blocked('a pending agreement cannot stand in for fresh missing-repair arithmetic');
reset();envelopes=[{id:'existing',state:'awaiting_counterparty',terms,recipients:[]}];await blocked('existing envelopes do not enter the repair-completion path');
reset();history.transcript.at(-1).message='Not yet.';assert.equal((await send()).status,'confirmation_needed');assert.equal(claims,0);history.transcript.at(-1).message='Yes, please.';
reset();await assert.rejects(send({agreedPriceCents:9100000}),/updated_property_review_required/);assert.equal(claims,0,'model price overrides cannot expand the accepted ceiling');
console.log('PASS accepted seller-repair calculations reach one agreement with exact fresh scope/snapshot and spoken terms; drift, missing bindings, higher repairs, unresolved debt, pending work and unaccepted prices remain blocked. No provider requests.');
