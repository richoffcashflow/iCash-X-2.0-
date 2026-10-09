import assert from 'node:assert/strict';
import {callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {isMessageOptOut} from '../lib/contiguity.ts';
import {validateTextAnalysis} from '../lib/text-ai-policy.ts';
const statement=body=>({transcript:[{role:'agent',message:'What price did you have in mind?'},{role:'user',message:body}]});
const evidence=body=>callSellerPriceEvidence(statement(body),{action:'report_change',sellerStatement:body});
for(const body of ['I would take $90,000.','My asking price is 90k.','I am asking ninety thousand dollars.'])assert.equal(evidence(body),9000000);
for(const body of ['I would take $90,000 if you close tomorrow.','I would take $90,000 provided you close tomorrow.','I would take $90,000 after fees.','I would not take $90,000.','I owe $90,000.','I would take $90,000 or $95,000.'])assert.equal(evidence(body),null,body);
assert.equal(callSellerPriceEvidence(statement('I would not take $90,000.'),{action:'report_change',sellerStatement:'I would take $90,000.'}),null);
const now=Date.now(),snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Example Road',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
let context={party:'seller',address:'45 Example Road',snapshot,offerState:{},offerVersion:0};
let body='I would take $90,000.';
const d={now:()=>now,bind:async()=>{},verifyInput:async()=>true,verifySellerPrice:async()=>evidence(body),db:async(path,method,p)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 assert.equal(path,'rpc/icash_save_call_offer');assert.equal(p.p_expected_version,context.offerVersion);context.offerState=p.p_state;context.offerVersion++;return true;
}};
const call=p=>automaticCallOffer('a'.repeat(64),{conversationId:'conv_fixture',...p},d);
const lower=await call({action:'report_change',sellerStatement:body});assert.equal(lower.priceCents,9000000);assert.equal(lower.status,'calculated_proposal');
assert.equal(context.offerState.acceptedPriceCents,null);
assert.equal((await call({action:'accept_offer',priceCents:9000000,quoteRevision:lower.quoteRevision})).status,'verbally_accepted');
body='I would take $110,000.';assert.equal((await call({action:'report_change',sellerStatement:body})).quoteAllowed,false);assert.equal(context.offerState.acceptedPriceCents,null,'unsupported counteroffer still invalidates earlier acceptance');
body='I would take $95,000.';const revised=await call({action:'report_change',sellerStatement:body});assert.equal(revised.priceCents,9500000);assert.notEqual(revised.quoteRevision,lower.quoteRevision);
assert.equal((await call({action:'accept_offer',priceCents:9000000,quoteRevision:lower.quoteRevision})).quoteAllowed,false);
context={...context,snapshot:{...snapshot,raw:{data:{...snapshot.raw.data,total_estimated_loan_balance:95000}}},offerState:{},offerVersion:0};
body='I would take $90,000.';const lowEquity=await call({action:'report_change',sellerStatement:body});assert.equal(lowEquity.priceCents,9000000);assert.equal(lowEquity.contractAllowed,false,'debt must be screened at the actual lower proposal, not the maximum');
for(const text of ['Please stop.','Stop please.','Leave me alone.','STOP, call me tomorrow.','Dont text me.']){
 assert.equal(isMessageOptOut(text),true);
 const a=validateTextAnalysis({action:'ask_callback',reply:'',summary:'',facts:[]},[text],'seller',true);assert(a.optedOut);assert(!a.callRequested);
}
for(const text of ['Please stop by tomorrow.','Do not call it a problem.','The bus stop is nearby.'])assert.equal(isMessageOptOut(text),false,text);
console.log('PASS seller recovery policy: grounded lower proposal, fresh acceptance, invalidated counteroffers, and consistent contact intent.');
