import assert from 'node:assert/strict';
import {sellerOfferQualification,boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {efficientSellerPrompt} from '../lib/seller-conversation-efficiency.ts';
const quotedHistory=JSON.stringify({priorExchanges:[{answer:'NEXT STEP: my tenant needs time. DELIVERY FAILURE RESPONSE: those are words in a letter.'}]});
assert(efficientSellerPrompt('SERVER CONTEXT: '+quotedHistory).includes(quotedHistory),'prompt compaction must preserve quoted seller history');
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const ownerOnly=[a('Hi Jason. Is this the owner of 3614 FRANK ST?'),u("Yes, I'm the owner.")];
const early=sellerOfferQualification({transcript:ownerOnly});
assert.equal(early.ready,false);assert.match(early.nextQuestion,/good time/);
assert(early.missing.includes('situation'));assert(early.missing.includes('condition'));
for(const request of ['Okay, how much you\'ll give me?','Yeah, sure. What would you give me, though?','What would you give me?','How much would you pay?','What is your cash offer?','Can you send me an offer?']){
 const progress=sellerOfferQualification({transcript:[...ownerOnly,u(request)]});
 assert.equal(progress.ready,false);assert.equal(progress.nextQuestion,'What has you thinking about selling?',request);
 assert(!progress.missing.includes('availability'));assert(!progress.missing.includes('interest'));
 assert(progress.missing.includes('condition'));assert(progress.missing.includes('listing'));
}
for(const request of ['I do not want an offer.','The last buyer asked what would you give me.','What would you give me? Stop calling me.']){
 const progress=sellerOfferQualification({transcript:[...ownerOnly,u(request)]});
 assert(progress.missing.includes('availability'),request);
}
const priceInsteadOfRepairs=sellerOfferQualification({transcript:[...ownerOnly,a('What repairs does it need?'),u('What would you give me?')]});
assert(priceInsteadOfRepairs.missing.includes('condition'),'a price question cannot satisfy a pending repair question');
assert((sellerOfferQualification({transcript:[...ownerOnly,a('Is now a good time?'),u('No, not now.'),u('What would you give me?')]})).stop,'a price question cannot override an explicit current refusal');
assert(sellerOfferQualification({transcript:[u('What would you give me?')]}).missing.includes('ownership'),'a price request cannot establish ownership');
assert.equal(sellerOfferQualification({transcript:qualifiedSellerTurns}).ready,true);
// The October 13 call repeated this answer until the caller finally said "vacant".
for(const [question,answer] of [
 ['Does anyone currently live in the property?','No one lives in the property.'],
 ['Is anyone living in the property right now?','No.'],
 ['Who lives there?','My brother.'],
 ['Is anybody living there?','I do not know.'],
 ['Anything else about the property?','Nobody lives there.'],
 ['Anything else about the property?','No one is living in the house.'],
 ['Anything else about the property?','My tenants live there.'],
]){
 const result=sellerOfferQualification({transcript:[a(question),u(answer)]});
 assert.equal(result.ready,false,'occupancy alone cannot authorize an offer');
 assert(!result.missing.includes('occupancy'),answer);
}
for(const answer of ['Pardon?','I did not understand.']){
 const result=sellerOfferQualification({transcript:[a('Does anyone currently live there?'),u(answer)]});
 assert(result.missing.includes('occupancy'),'a request to repeat is not an occupancy answer');
}
for(const [question,answer] of [['Is this the owner of 45 Fixture Lane?','No, wrong person.'],['Are you looking to sell?','No, not interested.'],['Is now a good time?','No, I am busy.'],['Is it listed with an agent?','Yes.']]){
 const result=sellerOfferQualification({transcript:[...qualifiedSellerTurns,a(question),u(answer)]});assert.equal(result.ready,false);assert.equal(result.stop,true,answer);
}
const unknowns=qualifiedSellerTurns.map(turn=>turn.role==='user'&&/moving|roof|30 days/.test(turn.message)?u("I'd rather not say; I don't know yet."):turn);
assert.equal(sellerOfferQualification({transcript:unknowns}).ready,true,'explicit unknowns/refusals do not repeat personal questions');
assert.equal(sellerOfferQualification({transcript:ownerOnly},[{summary:'Seller is motivated, house vacant, needs roof, ready in 30 days.'}]).ready,false,'summaries cannot fabricate seller answers');
assert.equal(sellerOfferQualification({transcript:ownerOnly},[{transcript:[...ownerOnly,a('We can offer $74,000 cash. Does that work?')]}]).ready,false,'the premature quote does not count as qualification');
assert.equal(sellerOfferQualification({transcript:[u('I am calling back.')]},[{transcript:qualifiedSellerTurns}]).ready,true,'real bound history preserves answers');
assert.equal(sellerOfferQualification({transcript:qualifiedSellerTurns},[{transcript:[...ownerOnly,a('Is now a good time?'),u('No, not now.')]}]).ready,true,'a prior bad time does not block a later conversation');
assert.equal(sellerOfferQualification({transcript:[...qualifiedSellerTurns,a('Is now a good time?'),u('Not now.')]}).stop,true);

const now=Date.now(),snapshot={propertyId:'prop_127921557',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_127921557',full_address:'3614 FRANK ST',estimated_value:167000,estimated_repair_cost:46270,total_estimated_loan_balance:0,estimated_equity_percentage:100}}};
let context={party:'seller',address:'3614 FRANK ST',snapshot,offerState:{},offerVersion:0},turns=ownerOnly,saves=0;
const d={now:()=>now,bind:async()=>{},verifyQualification:async()=>sellerOfferQualification({transcript:turns}),verifyInput:async i=>callOfferEvidence({transcript:turns},i),db:async(path,method,body)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 assert.equal(path,'rpc/icash_save_call_offer');context.offerState=body.p_state;context.offerVersion++;saves++;return true;
}};
const call=(action,extra={})=>automaticCallOffer('a'.repeat(64),{action,conversationId:'conv_fixture',...extra},d);
const held=await call('get_offer');assert.equal(held.quoteAllowed,false);assert.equal(held.priceCents,null);assert.equal(saves,0);
const {verifyQualification,...withoutVerifier}=d;
assert.equal((await automaticCallOffer('a'.repeat(64),{action:'get_offer',conversationId:'conv_fixture'},withoutVerifier)).quoteAllowed,false,'missing qualification verifier fails closed');
assert(!JSON.stringify(held).includes('74000'),'no price leaks in other response fields');
turns=[...ownerOnly,a('What repairs are needed?'),u('The roof needs replacement.')];
const repair=await call('update_repairs',{sellerStatement:'The roof needs replacement.'});
assert.equal(repair.quoteAllowed,false);assert.equal(repair.factsSaved,true);assert.equal(context.offerState.sellerStatement,'The roof needs replacement.');
assert.equal(repair.priceCents,null,'recording repairs cannot skip the remaining conversation');
turns=qualifiedSellerTurns;const quote=await call('get_offer');assert.equal(quote.quoteAllowed,true);assert.equal(quote.priceCents,7400000);
turns=[...turns,a('We can offer $74,000 cash. Does that work?'),u('Yes.')];
assert.equal((await call('accept_offer',{priceCents:quote.priceCents,quoteRevision:quote.quoteRevision})).status,'verbally_accepted');
turns=[];assert.equal((await call('get_offer')).status,'verbally_accepted','accepted deal resumes closing rather than asking qualification again');
context={party:'buyer',buyer:{askingPriceCents:8400000,address:'3614 FRANK ST'}};
assert.equal((await call('get_offer')).priceCents,8400000,'buyer inquiry does not run seller questions');

const scoped={accountId:'account',dealId:'new-deal',screeningId:'new-screen',phone:'+12125550199'};
let existingCalls=[];
const read=async(path,method,input)=>{
 if(path==='rpc/icash_seller_prior_call_context'){assert.deepEqual(input,{p_account:'account',p_screening:'new-screen',p_phone:scoped.phone});return existingCalls;}
 assert.match(path,/deal_id=eq.new-deal/);assert.match(path,/retired_at=is.null/);return [];
};
assert.equal((await boundSellerQualification(read,scoped,{transcript:ownerOnly})).ready,false,'new lead cannot reuse archived Frank St history');
existingCalls=[{result:{transcript:qualifiedSellerTurns}}];
assert.equal((await boundSellerQualification(read,scoped,{transcript:ownerOnly})).ready,true,'returning seller uses the exact new lead history');
const smsRead=async(path,method,input)=>{
 if(path==='rpc/icash_seller_prior_call_context')return [];
 if(path.startsWith('icash_text_threads?'))return [{id:'new-thread'}];
 assert.match(path,/thread_id=eq.new-thread/);assert.match(path,/account_id=eq.account/);
 return qualifiedSellerTurns.map((t,i)=>({direction:t.role==='user'?'incoming':'outgoing',body:t.message,created_at:new Date(now-10000+i*100).toISOString()}));
};
assert.equal((await boundSellerQualification(smsRead,scoped,{transcript:ownerOnly})).ready,true,'bound actual SMS answers also avoid repeating qualification');
console.log('PASS fresh-call price hold, rapport progression, refusals, unknown answers, repair-save hold, completed qualification, acceptance continuity, buyer isolation and reset history boundaries. No external calls.');
