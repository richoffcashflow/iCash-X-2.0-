import assert from 'node:assert/strict';
import {sellerOfferQualification,boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';

const agent=message=>({role:'agent',message}),seller=message=>({role:'user',message});
const now=Date.parse('2026-10-14T20:00:00Z'),token='a'.repeat(64),conversationId='conv_sellerscenarios';
const snapshot={propertyId:'prop_127921557',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_127921557',full_address:'3614 FRANK ST',estimated_value:167000,estimated_repair_cost:46270,total_estimated_loan_balance:0,estimated_equity_percentage:100}}};
let context={party:'seller',address:'3614 FRANK ST',snapshot,offerState:{},offerVersion:0};
let turns=[agent('Are you the owner of this property?'),seller('Yes.')],writes=0;
const db=async(path,method,input)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 assert.equal(path,'rpc/icash_save_call_offer');
 assert.equal(input.p_expected_version,context.offerVersion);
 context.offerState=structuredClone(input.p_state);context.offerVersion++;writes++;return true;
};
const dependencies={db,now:()=>now,bind:async()=>{},verifyQualification:async()=>sellerOfferQualification({transcript:turns}),verifyInput:async input=>callOfferEvidence({transcript:turns},input)};
const call=(action,extra={})=>automaticCallOffer(token,{action,conversationId,...extra},dependencies);

// 1. Rapport precedes a price; an acknowledgement cannot change which question
// the seller answered. This previously stopped the call as a false wrong-owner.
const fresh=await call('get_offer');
assert.equal(fresh.quoteAllowed,false);assert.equal(fresh.priceCents,null);assert.equal(writes,0);
for(const leadIn of ['Thanks for confirming you are the owner. ','Thanks for confirming you are the owner, ','Thanks for confirming you want to sell. ']){
 const result=sellerOfferQualification({transcript:[...qualifiedSellerTurns,agent(leadIn+'Is anyone living in the property?'),seller('No.')]});
 assert.deepEqual(result,{ready:true},leadIn);
}
assert.equal(sellerOfferQualification({transcript:[...qualifiedSellerTurns,agent('Are you the owner?'),seller('No, wrong person.')]}).stop,true,'a genuine ownership correction still stops the pitch');

// 2. Asking for a repeat is not an answer. An explicit unknown to a personal
// question is an answer, but does not manufacture ownership or sale permission.
for(const request of ['Can you ask that again?','Could you please repeat it?','I did not catch that.','Say that again.']){
 const result=sellerOfferQualification({transcript:[agent('What repairs does the property need?'),seller(request)]});
 assert(result.missing.includes('condition'),request);
 assert(result.missing.includes('availability'),'mishearing cannot imply availability from a fabricated condition answer');
}
const unknown=sellerOfferQualification({transcript:[agent('What repairs does the property need?'),seller('I do not know yet.')]});
assert(!unknown.missing.includes('condition'));assert(unknown.missing.includes('ownership'));assert(unknown.missing.includes('interest'));

// 3. New material facts invalidate a saved acceptance even when the researched
// price is unchanged; subsequent reads cannot silently restore authority.
turns=structuredClone(qualifiedSellerTurns);
const quote=await call('get_offer');assert.equal(quote.priceCents,7400000);
turns.push(agent('Our cash offer is $74,000. Does that work?'),seller('Yes.'));
assert.equal((await call('accept_offer',{priceCents:quote.priceCents,quoteRevision:quote.quoteRevision})).status,'verbally_accepted');
const acceptedContext=structuredClone(context);
turns.push(agent('Is there anything else we should know?'),seller('There is another owner.'));
const changed=await call('report_change',{sellerStatement:'There is another owner.'});
assert.equal(changed.quoteAllowed,false);assert.equal(context.offerState.acceptedPriceCents,null);
assert.equal(context.offerState.factsPending,true);assert.equal((await call('get_offer')).quoteAllowed,false);

// 4. A brief connection check and the provider's acceptance receipt do not erase
// the actual answer. A later withdrawal still revokes that same evidence.
const revision='b'.repeat(64),input={action:'accept_offer',priceCents:7400000,quoteRevision:revision};
const receipt=status=>({role:'agent',tool_results:[{tool_name:'icash_offer_and_contract',is_error:false,result_value:JSON.stringify({quoteAllowed:true,priceCents:7400000,quoteRevision:revision,status})}]});
const interrupted=[receipt('calculated_proposal'),agent('Our cash offer is $74,000. Does that work?'),agent('Are you still there?'),seller("Yes, let's do it."),receipt('verbally_accepted'),agent('What closing date works for you?'),seller('October 26, 2026.')];
assert.equal(callOfferEvidence({transcript:interrupted},input),true);
assert.equal(callOfferEvidence({transcript:[...interrupted,seller('Hold off, I need to think.')]},input),false);

// 5. A return call reuses only bound answers and the exact accepted price. It
// does not invent a contract send or force the seller through qualification again.
let historyReads=0;
const bound=await boundSellerQualification(async(path,method,input)=>{
 if(path==='rpc/icash_seller_prior_call_context'){
  historyReads++;assert.deepEqual(input,{p_account:'account',p_screening:'screen',p_phone:'+12125550199'});
  return [{completed_at:'2026-10-14T19:55:00Z',result:{transcript:qualifiedSellerTurns}}];
 }
 assert.match(path,/account_id=eq.account/);assert.match(path,/deal_id=eq.deal/);return [];
},{accountId:'account',dealId:'deal',screeningId:'screen',phone:'+12125550199'},{transcript:[seller('I am calling back about the agreement.')]});
assert.equal(historyReads,1);assert.deepEqual(bound,{ready:true});
context=acceptedContext;turns=[seller('I am calling back about the agreement.')];
const resumed=await call('get_offer');assert.equal(resumed.status,'verbally_accepted');assert.equal(resumed.priceCents,7400000);
assert.notEqual(resumed.sent,true,'an offer read cannot claim text delivery');

console.log('PASS 5 seller scenarios: rapport/question scope; repeat versus unknown; material change; interrupted acceptance; bound return-call continuity. Local fixtures only; no provider traffic.');
