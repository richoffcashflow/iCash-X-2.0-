import assert from 'node:assert/strict';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
globalThis.fetch=async()=>{throw Error('NO NETWORK: offline source fixtures only');};
const now=Date.now(),address='45 Oak Road';
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const base={accountId:'account',jobId:'job',threadId:'thread',sourceId:'answer',dealId:'deal',screeningId:'screen',phone:'+12125550123',ownerUserId:'owner',ownerEmail:'owner@example.invalid',principal:'Fixture Buyer',address,snapshot,terms:{seller:'',buyer:'Fixture Buyer',address,legalDescription:'Lot 1, Fixture Subdivision',state:'TX',priceCents:6000000,priceSource:'proposed'},offerState:{acceptedPriceCents:6000000,quotedPriceCents:6000000,quoteRevision:'a'.repeat(64),textThreadId:'thread',processedSource:'older'},offerVersion:1,messages:[],historyComplete:true,history:[{sourceId:'qualified',channel:'voice',transcript:qualifiedSellerTurns}],fingerprint:'fixture'};
const sent=(id,action,body,extra={})=>({id,direction:'outgoing',state:'delivered',providerId:'provider-'+id,action,body,...extra});
const answer=(id,body)=>({id,direction:'incoming',state:'received',providerId:null,body});
const pair=(question,source,extra={})=>({sourceId:source.id,channel:'sms',transcript:[{role:'agent',message:question?.body??''},{role:'user',message:source.body,sourceId:source.id,...extra}]});
function context(question,source,state=base.offerState,history=base.history){return {...base,offerState:structuredClone(state),sourceId:source.id,messages:[question,source].filter(Boolean),history:[...history,pair(question,source)]};}
const nameQuestion=sent('name','legal_name','What is your full legal name?'),nameAnswer=answer('name-answer','Jane Seller');
// Before repair, revision drift cleared the accepted $60,000 after calculating
// its next quote. The following Yes recalculated $90,000 from the ceiling.
const refreshed=planSellerTextOffer(context(nameQuestion,nameAnswer),now);
assert.equal(refreshed.action,'cash_offer');
assert.equal(refreshed.state.acceptedPriceCents,6000000,'revision changes preserve the original price while requiring new confirmation');
assert.equal(refreshed.state.quotedPriceCents,6000000);
const priceQuestion=sent('new-price','cash_offer',refreshed.body,{priceCents:refreshed.state.quotedPriceCents,quoteRevision:refreshed.state.quoteRevision}),yes=answer('fresh-yes','Yes.');
const accepted=planSellerTextOffer(context(priceQuestion,yes,refreshed.state),now);
assert.equal(accepted.state.acceptedPriceCents,6000000,'fresh Yes confirms the exact delivered $60,000, never the $90,000 ceiling');
assert.notEqual(accepted.action,'cash_offer');
assert.equal(accepted.state.receiptPriceAuthority,undefined,'only exact current confirmation restores price authority');
// Unknown replies preserve evidence but cannot silently inherit its authority
// after a later call re-answers ordinary qualification facts.
const uncertain=answer('uncertain','No.');
const ambiguous={...base,sourceId:uncertain.id,messages:[uncertain],history:[...base.history,pair(null,uncertain,{questionUnverified:true})]};
const clarifying=planSellerTextOffer(ambiguous,now);
assert.equal(clarifying.action,'clarify_source_answer');
assert.equal(clarifying.state.acceptedPriceCents,6000000);
assert.equal(clarifying.state.receiptPriceAuthority.sourceId,uncertain.id);
const followup=planSellerTextOffer(context(nameQuestion,nameAnswer,clarifying.state),now);
assert.equal(followup.action,'cash_offer','ordinary later facts do not restore acceptance');
assert.equal(followup.state.acceptedPriceCents,6000000);
assert.equal(followup.state.receiptPriceAuthority.sourceId,uncertain.id);
// Canonical receipt evidence wins over a delivered flag whose actual delivery
// occurred after this original answer. A short answer cannot borrow its body.
const late=answer('late','Yes.'),lateQuestion=sent('late-question','cash_offer',priceQuestion.body,{priceCents:6000000,quoteRevision:refreshed.state.quoteRevision});
const latePlan=planSellerTextOffer({...context(lateQuestion,late,{...refreshed.state,acceptedPriceCents:null}),history:[...base.history,pair(null,late,{questionUnverified:true})]},now);
assert.equal(latePlan.action,'clarify_source_answer');assert.equal(latePlan.state.acceptedPriceCents,null);
// A rejection or counteroffer clears acceptance. No later unrelated answer or
// repeated uncertainty can restore the stored original price from its marker.
for(const body of ['No.','Could you do $75,000?','I changed my mind.','Yes, I reject the offer.']){
 const rejection=answer('reject-'+body,body),c=context(priceQuestion,rejection,refreshed.state);
 const p=planSellerTextOffer(c,now);assert.equal(p.state.acceptedPriceCents,null,body);
 if(p.kind!=='review'){
  const follow=planSellerTextOffer(context(nameQuestion,nameAnswer,p.state),now);
  assert.equal(follow.state.acceptedPriceCents,null,'a followup cannot restore rejected original: '+body);
 }
}
// Repeated ambiguous replies keep the first accepted-price evidence without
// making its newest question authoritative. A later original receipt may
// resolve only that exact source and exact current quote.
const again=answer('uncertain-again','Yes.');
const repeated=planSellerTextOffer({...ambiguous,offerState:clarifying.state,sourceId:again.id,messages:[again],history:[...ambiguous.history,pair(null,again,{questionUnverified:true})]},now);
assert.equal(repeated.action,'clarify_source_answer');
assert.deepEqual(repeated.state.receiptPriceAuthority,clarifying.state.receiptPriceAuthority);
const original=answer('original-yes','Yes.');
const originalQuestion=sent('original-quote','cash_offer',priceQuestion.body,{priceCents:6000000,quoteRevision:refreshed.state.quoteRevision});
const held=planSellerTextOffer({...context(originalQuestion,original,{...refreshed.state,receiptPriceAuthority:undefined}),history:[...base.history,pair(null,original,{questionUnverified:true})]},now);
assert.equal(held.action,'clarify_source_answer');
const lateOriginal=planSellerTextOffer(context(originalQuestion,original,held.state),now);
assert.equal(lateOriginal.state.acceptedPriceCents,6000000);
assert.equal(lateOriginal.state.receiptPriceAuthority,undefined,'exact original receipt resolves only its confirmed original quote');
for(const change of [m=>({...m,body:'Our cash proposal is $90,000. Does that work?',priceCents:9000000}),m=>({...m,quoteRevision:'b'.repeat(64)})]){
 const altered=change(originalQuestion);
 const other=planSellerTextOffer(context(altered,original,held.state),now);
 assert.notEqual(other.kind,'agreement');assert.equal(other.action,'cash_offer');
 assert.equal(other.state.acceptedPriceCents,6000000,'different price/revision cannot replace the original');
 assert(other.state.receiptPriceAuthority);
}
for(const history of [base.history,[...base.history,pair(nameQuestion,{...nameAnswer,body:'Someone Else'})],[...base.history,pair(nameQuestion,nameAnswer),pair(nameQuestion,nameAnswer)]]){
 const missing=planSellerTextOffer({...context(nameQuestion,nameAnswer),history},now);
 assert.equal(missing.reason,'seller_source_evidence_required','missing, mismatched or duplicate current canonical source holds');
 assert.notEqual(missing.kind,'agreement');
}
// Final terms and signing identity cannot borrow a question from another source.
const close=new Date(now+30*86400000).toISOString().slice(0,10);
const closingHistory={sourceId:'closing-call',channel:'voice',transcript:[
 {role:'agent',message:'What is your full legal name for the agreement?'},{role:'user',message:'Jane Seller.'},
 {role:'agent',message:'Are you the only owner and decision maker?'},{role:'user',message:'Yes, just me.'},
 {role:'agent',message:'What exact closing date works?'},{role:'user',message:close},
 {role:'agent',message:'May we inspect the property before closing?'},{role:'user',message:'Yes.'},
]};
const finalQuestion=sent('terms','confirm_terms',`$60,000 cash; closing ${close}; 10-day inspection. Do these terms work, and may I text the agreement now?`),finalYes=answer('terms-answer','Yes.');
const readyContext=context(finalQuestion,finalYes,accepted.state,[...base.history,closingHistory]);
assert.equal(planSellerTextOffer(readyContext,now).kind,'agreement','exact current canonical pair can authorize its terms');
const separated={...readyContext,history:[...base.history,closingHistory,{sourceId:'question-other-source',transcript:[{role:'agent',message:finalQuestion.body}]},{sourceId:finalYes.id,transcript:[{role:'user',sourceId:finalYes.id,message:finalYes.body}]}]};
assert.equal(planSellerTextOffer(separated,now).action,'confirm_terms','a different source cannot supply the current question');
for(const extra of [{questionUnverified:true},{sourceClockUnverified:true,questionUnverified:true}])assert.notEqual(planSellerTextOffer({...readyContext,history:[...base.history,closingHistory,pair(finalQuestion,finalYes,extra)]},now).kind,'agreement');
assert.equal(planSellerTextOffer({...readyContext,history:[...readyContext.history,pair(finalQuestion,finalYes)]},now).reason,'seller_source_evidence_required');
const noName={...closingHistory,transcript:closingHistory.transcript.slice(2)};
const identitySplit={...readyContext,offerState:{...accepted.state,closing:{legalName:'Jane Seller',date:close,inspection:'yes'}},history:[...base.history,noName,{transcript:[{role:'agent',message:nameQuestion.body}]},{transcript:[{role:'user',message:'Jane Seller.'}]},pair(finalQuestion,finalYes)]};
assert.equal(planSellerTextOffer(identitySplit,now).action,'legal_name','cross-source name answer is not signing identity');
console.log('PASS original seller price authority, revision drift, canonical late receipts, fresh exact acceptance and refusal lifecycle. No provider calls.');
