import assert from 'node:assert/strict';
import {sellerOfferQualification,boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const ownerOnly=[a('Hi Jason. Is this the owner of 3614 FRANK ST?'),u("Yes, I'm the owner.")];
const early=sellerOfferQualification({transcript:ownerOnly});
assert.equal(early.ready,false);assert.match(early.nextQuestion,/good time/);
assert(early.missing.includes('situation'));assert(early.missing.includes('condition'));
assert.equal(sellerOfferQualification({transcript:qualifiedSellerTurns}).ready,true);
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
