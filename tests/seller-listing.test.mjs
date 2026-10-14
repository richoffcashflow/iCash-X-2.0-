import assert from 'node:assert/strict';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {automaticOfferReceptionPrompt,payoffAutomaticOfferReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {sellerOfferQualification} from '../lib/seller-offer-qualification.ts';
const question='Is the property currently listed with a real estate agent?';
const evidence=(answer,previous=question,statement=answer)=>sellerListingEvidence({transcript:[{role:'agent',message:previous},{role:'user',message:answer}]},{action:'report_change',sellerStatement:statement});
for(const answer of ['Yes.','It is listed with my agent.','My property is listed with a realtor.'])assert.equal(evidence(answer),true);
for(const answer of ['No.','It is not currently listed.','My listing has expired.'])assert.equal(evidence(answer),false);
assert.equal(evidence('Yes.','Do you want to sell?'),null);
assert.equal(evidence('It is not listed with my agent.',question,'It is listed with my agent.'),null);
assert.equal(evidence('I might list it with an agent.'),null);
const followup="Thanks for letting me know it's not listed with an agent. Are you interested in selling the property to Clear Path Homes?";
for(const answer of ['Yes.','No.']){
 assert.equal(evidence(answer,followup),null,'selling interest must not change listing status');
 assert.equal(evidence(answer,followup.replace('. Are',', are')),null,'acknowledgement in the same sentence is not the question');
 assert.equal(evidence(answer,'Is it listed with an agent, and do you want to sell?'),null,'a bare answer to the final question does not answer an earlier one');
}
for(const prompt of [question,question.slice(0,-1),'Thanks for sharing. Is your home currently listed with a realtor?','Just to confirm, do you have a listing agreement with an agent?']){
 assert.equal(evidence('Yes.',prompt),true);
 assert.equal(evidence('No.',prompt),false);
}
assert.equal(evidence('Yes.','Is your home not listed with an agent?'),null);
assert.equal(evidence('Yes.',"You said it's not listed with an agent."),null);
const replay={transcript:[
 {role:'agent',message:'Are you the owner of this property?'},{role:'user',message:'Yes.'},
 {role:'agent',message:'What has you thinking about selling?'},{role:'user',message:'I am moving.'},
 {role:'agent',message:'What repairs does it need?'},{role:'user',message:'It needs paint.'},
 {role:'agent',message:'Is anyone living in the property?'},{role:'user',message:'It is vacant.'},
 {role:'agent',message:'When would you ideally like to sell?'},{role:'user',message:'As soon as possible.'},
 {role:'agent',message:question},{role:'user',message:"No, it's not listed with a agent."},
 {role:'agent',message:followup},{role:'user',message:'Yes.'},
]};
assert.deepEqual(sellerOfferQualification(replay),{ready:true},'the actual failed-call sequence retains the saved unlisted answer');
const listedReplay={transcript:[...replay.transcript.slice(0,-4),
 {role:'agent',message:question},{role:'user',message:'Yes.'},
 {role:'agent',message:'Thanks for confirming it is listed with an agent. Are you interested in selling?'},{role:'user',message:'Yes.'},
]};
assert.equal(sellerOfferQualification(listedReplay).stop,true,'unrelated yes must also preserve a real listing exclusion');
const now=Date.now(),context={party:'seller',address:'45 Fixture Lane',offerState:{},offerVersion:0,snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',estimated_value:127000,estimated_repair_cost:43960,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}}};
let seller='Yes.';
const d={now:()=>now,bind:async()=>{},verifyQualification:async()=>({ready:true}),verifyInput:async()=>true,verifyListingStatus:async i=>evidence(seller,question,i.sellerStatement),db:async(path,method,b)=>{if(path==='rpc/icash_call_offer_context')return context;assert.equal(path,'rpc/icash_save_call_offer');assert.equal(b.p_expected_version,context.offerVersion);context.offerState=b.p_state;context.offerVersion++;return true;}};
const call=(action,extra={})=>automaticCallOffer('a'.repeat(64),{action,conversationId:'conv_fixture',...extra},d);
assert.equal((await call('get_offer')).priceCents,4800000);
const listed=await call('report_change',{sellerStatement:seller});assert.equal(listed.reason,'listed_with_agent');assert.equal(context.offerState.contractBlocked,true);assert.equal((await call('get_offer')).quoteAllowed,false);
assert.equal((await call('accept_offer',{priceCents:4800000,quoteRevision:'b'.repeat(64)})).quoteAllowed,false);
seller='No.';assert.equal((await call('report_change',{sellerStatement:seller})).priceCents,4800000);assert.equal(context.offerState.acceptedPriceCents,null,'listing correction does not manufacture acceptance');
assert.match(automaticOfferReceptionPrompt,/retry the same action at most once/i);assert.match(automaticOfferReceptionPrompt,/ask each qualification question once/i);
assert.equal(payoffAutomaticOfferReceptionPolicyHash,'1ad640490c33ff5294e6bd728ed6f382af7909756256d9bac78a965032ae742b','existing live branch remains unchanged while staging');
console.log('PASS listing evidence, persisted exclusion, exact-price recovery, no invented acceptance and bounded conversation recovery.');
