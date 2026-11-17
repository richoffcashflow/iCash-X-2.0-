import assert from 'node:assert/strict';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
globalThis.fetch=async()=>{throw Error('NO NETWORK: offline source fixtures only');};
const now=Date.now(),address='45 Oak Road';
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const base={accountId:'account',jobId:'job',threadId:'thread',sourceId:'answer',dealId:'deal',screeningId:'screen',phone:'+12125550123',ownerUserId:'owner',ownerEmail:'owner@example.invalid',principal:'Fixture Buyer',address,snapshot,terms:{seller:'',buyer:'Fixture Buyer',address,legalDescription:'Lot 1, Fixture Subdivision',state:'TX',priceCents:6000000,priceSource:'proposed'},offerVersion:1,fingerprint:'fixture',conversionEnabled:true,historyComplete:true};
const qualified={sourceId:'qualified',channel:'voice',transcript:qualifiedSellerTurns};
const saved=coverage=>({acceptedPriceCents:6000000,quotedPriceCents:6000000,quoteRevision:'a'.repeat(64),textThreadId:'thread',processedSource:'older',payoffReport:{mortgageCents:8000000,otherDebtCents:1000000,...coverage}});
function context(question,body,state){
 const outgoing={id:'question',direction:'outgoing',state:'delivered',providerId:'original-receipt',action:'payoff',body:question};
 const incoming={id:base.sourceId,direction:'incoming',state:'received',providerId:null,body};
 return {...base,offerState:structuredClone(state),messages:[outgoing,incoming],history:[qualified,{sourceId:incoming.id,channel:'sms',transcript:[{role:'agent',message:question},{role:'user',message:body,sourceId:incoming.id}]}]};
}
const mortgage='What is the current mortgage payoff balance?',other='Are there any other loans, liens, unpaid taxes or HOA balances besides that mortgage?';
const positive={coveredShortfallCents:3000000,coverageDeclined:false},negative={coveredShortfallCents:0,coverageDeclined:true};
// Each changed debt removes the old positive or negative coverage authority,
// preserves the other balance and the original lower accepted purchase price.
for(const coverage of [positive,negative])for(const [question,body,mortgageCents,otherDebtCents,difference] of [
 [mortgage,'My mortgage payoff is $75,000.',7500000,1000000,'$25,000'],
 [mortgage,'My mortgage payoff is $85,000.',8500000,1000000,'$35,000'],
 [other,'$5,000.',8000000,500000,'$25,000'],
 [other,'No.',8000000,0,'$20,000'],
 [mortgage,'It is paid off.',0,1000000,null],
]){
 const c=context(question,body,saved(coverage)),plan=planSellerTextOffer(c,now);
 assert.equal(plan.kind,'message',body);assert.equal(plan.action,difference?'payoff':'cash_offer',body);
 if(difference)assert(plan.body.includes('difference is '+difference),plan.body);
 assert.deepEqual(plan.state.payoffReport,{mortgageCents,otherDebtCents,coveredShortfallCents:undefined,coverageDeclined:undefined});
 assert.equal(plan.state.acceptedPriceCents,6000000);assert.equal(plan.state.quotedPriceCents,6000000,'debt changes cannot raise a $60k acceptance to the $90k research ceiling');
 assert.equal(plan.state.contractBlocked,!!difference);assert.equal(plan.state.receiptPriceAuthority.priceCents,6000000);
 const replay=planSellerTextOffer({...c,offerState:plan.state},now);
 assert.deepEqual(replay.state.payoffReport,plan.state.payoffReport,'same-source replay cannot restore old coverage');assert.equal(replay.kind,'message');assert.equal(replay.action,plan.action);
 assert.deepEqual(c.offerState,saved(coverage),'the original source snapshot stays unchanged');
}
// An unchanged report or a purpose/uncertain interruption is not a new debt.
// Do not erase a valid answer or turn conversational words into fresh coverage.
for(const coverage of [positive,negative])for(const [question,body] of [[mortgage,'My mortgage payoff is $80,000.'],[other,'$10,000.'],[mortgage,'I do not know.'],[mortgage,'What is this for?'],[mortgage,'Not $75,000, it may be $85,000.']]){
 const plan=planSellerTextOffer(context(question,body,saved(coverage)),now);
 assert.deepEqual(plan.state.payoffReport,saved(coverage).payoffReport,body);
 assert.notEqual(plan.kind,'agreement',body);assert.equal(plan.state.acceptedPriceCents,6000000);
}
// A fresh answer to the new exact question can resolve its own difference;
// this cannot itself accept the purchase price or the final agreement terms.
const changed=planSellerTextOffer(context(mortgage,'My mortgage payoff is $75,000.',saved(negative)),now);
for(const [body,expectedAction,declined,amount] of [['Yes.', 'cash_offer',false,2500000],['No.','payoff',true,0]]){
 const c=context(changed.body,body,{...changed.state,processedSource:'previous-answer'});
 const plan=planSellerTextOffer(c,now);
 assert.equal(plan.action,expectedAction);assert.equal(plan.state.payoffReport.coverageDeclined,declined);assert.equal(plan.state.payoffReport.coveredShortfallCents,amount);
 assert.equal(plan.state.receiptPriceAuthority.priceCents,6000000);assert.notEqual(plan.kind,'agreement');
}
// A missing, duplicate or mismatched canonical source cannot revise a debt.
const exact=context(mortgage,'My mortgage payoff is $75,000.',saved(positive));
for(const history of [[qualified],[...exact.history,exact.history[1]],[qualified,{...exact.history[1],transcript:[{role:'agent',message:mortgage},{role:'user',sourceId:'answer',message:'My mortgage payoff is $80,000.'}]}]]){
 const plan=planSellerTextOffer({...exact,history},now);
 assert.equal(plan.reason,'seller_source_evidence_required');assert.deepEqual(plan.state.payoffReport,saved(positive).payoffReport);assert.notEqual(plan.kind,'agreement');
}
console.log('PASS changed seller mortgage/liens invalidate only old coverage; original lower price, zero/one-sided reports, unchanged/source replay and canonical evidence remain protected. No provider calls.');
