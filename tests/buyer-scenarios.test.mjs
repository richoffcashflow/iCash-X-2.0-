import {buyerSpeakingPolicy} from '../lib/buyer-speaking-policy.ts';
import {buyerValidatedPolicy} from '../lib/buyer-validated-policy.ts';
import {buyerAnswerPolicy} from '../lib/buyer-answer-policy.ts';
import {buyerConversationPolicy,buyerConversationResult,buyerConversationToolInstruction} from '../lib/buyer-conversation-policy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticCallOffer,calculateAutomaticCallOffer,currentCallUnavailableOffer} from '../lib/automatic-call-offer.ts';
import {renderBuyerPackage} from '../lib/buyer-disposition.ts';
import {buyerReceptionVariables} from '../lib/buyer-reception-context.ts';
const now=Date.parse('2026-10-09T19:00:00Z');
const buyer={address:'45 Fixture Lane',purchasePriceCents:15227050,assignmentFeeCents:1000000,askingPriceCents:16227050,depositCents:200000,closingDate:'2026-11-07'};
test('impossible closing dates are not spoken as rolled-over dates',()=>{
 for(const closingDate of ['2026-02-30','2026-11-31','2026-13-07','tomorrow',null]){
  const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,closingDate}},{},now);
  assert.equal(r.closingDate,null);assert.match(r.spokenOffer,/closing date needs confirmation/);
 }
 const stale=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,closingDate:'2026-10-01'}},{},now);
 assert.equal(stale.quoteAllowed,false);assert.equal(stale.reason,'buyer_terms_stale');
});
test('oversized or corrupt buyer prices fail closed without throwing during a call',()=>{
 for(const askingPriceCents of [100000000001,NaN,Infinity,-1,1.5,'16227050'])assert.equal(calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,askingPriceCents}},{},now).quoteAllowed,false);
});
test('voice receives supplied photo counts and research estimates, never raw attachments',()=>{
 const b={...buyer,latitude:30.03,longitude:-97.79,sellerPhotos:[{url:'https://api.contiguity.com/attachments/fixture.jpg',mime:'image/jpeg'},{url:'https://untrusted.example/a.jpg',mime:'image/jpeg'}],arvCents:25000000,repairsCents:2000000};
 const r=calculateAutomaticCallOffer({party:'buyer',buyer:b},{},now);
 assert.equal(r.propertyPhotoCount,2);assert.equal(r.sellerPhotoCount,1);assert.deepEqual(r.researchEstimates,{arv:'$250,000',repairs:'$20,000'});
 assert.match(r.spokenResearchEstimates,/two hundred fifty thousand dollars/);assert.match(r.spokenResearchEstimates,/twenty thousand dollars/);
 assert.equal(r.estimatedArvCents,undefined);assert.equal(r.estimatedRepairsCents,undefined);
 assert(!JSON.stringify(r).includes('https://api.contiguity.com'));assert.match(r.instruction,/not guarantees or an inspection/);
 const empty=calculateAutomaticCallOffer({party:'buyer',buyer},{},now);assert.equal(empty.propertyPhotoCount,0);assert.equal(empty.researchEstimates.arv,null);assert.match(empty.spokenResearchEstimates,/No ARV estimate/);
});
test('unconfirmed title and buyer exceptions have explicit review boundaries',()=>{
 const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,titleSelectionStatus:'needs_confirmation'}},{},now);
 assert.equal(r.spokenTitleStatus,'A title contact is recorded, but it still needs confirmation.');
 assert.match(r.instruction,/title contact is recorded but needs confirmation/);assert.match(r.instruction,/not an accepted change/);assert.match(r.instruction,/forfeited under every circumstance/);assert.match(r.instruction,/cannot text\/email a package/);
});
test('blocked availability cannot fall through to generic viewing coordination',()=>{
 for(const patch of [{reserved:true},{reserved:true,askingPriceCents:null},{closingDate:'2026-10-01'},{askingPriceCents:null}]){
  const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,...patch}},{},now);
  assert.equal(r.quoteAllowed,false);assert.equal(r.contractAllowed,false);assert.equal(r.party,'buyer');
  assert.equal(r.viewingAllowed,false);assert.equal(r.viewingFollowupRequired,false);assert.equal(r.callbackScheduled,false);
  assert.equal(r.spokenViewingFollowup,undefined);assert.equal(r.depositCents,undefined);
  assert.match(r.instruction,/Do not offer seller-availability follow-up/);
 }
});
test('missing terms prevent payment authorization without adopting buyer guesses',()=>{
 for(const patch of [{depositCents:null},{closingDate:null}]){
  const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,...patch}},{},now);
  assert.equal(r.quoteAllowed,true);assert.equal(r.paymentAuthorized,false);assert.equal(r.buyerTermsComplete,false);assert.equal(r.callbackScheduled,false);
 }
 assert.equal(calculateAutomaticCallOffer({party:'buyer',buyer},{},now).buyerTermsComplete,true);
 assert.equal(calculateAutomaticCallOffer({party:'buyer',buyer},{},now).paymentAuthorized,false);
});
test('provider lookup-failure fixture matches the actual no-context result',async()=>{
 let reads=0,binds=0;
 const r=await automaticCallOffer('a'.repeat(64),{action:'get_offer',conversationId:'conv_fixture'},{db:async()=>{reads++;return null;},bind:async()=>{binds++;},verifyInput:async()=>false});
 assert.equal(reads,2);assert.equal(binds,1);assert.deepEqual(r,currentCallUnavailableOffer());
 assert.equal(r.callbackScheduled,false);assert.match(r.instruction,/Do not agree when the caller assumes someone will reach out/);
});
test('buyer package, call tool and model context omit acquisition cost and spread',()=>{
 const quote=calculateAutomaticCallOffer({party:'buyer',buyer},{},now);
 for(const key of ['purchasePriceCents','assignmentFeeCents'])assert(!Object.hasOwn(quote,key),key);
 assert(!/15227050|1000000|152,270\.50|10,000/.test(JSON.stringify(quote)));
 const variables=buyerReceptionVariables({...buyer,status:'buyer'});
 assert(!/purchasePriceCents|assignmentFeeCents|15227050|1000000/.test(variables.icash_property_context));
 for(const details of [buyer,{...buyer,purchasePriceCents:undefined,assignmentFeeCents:undefined}]){
  const html=renderBuyerPackage({...details,principal:'Fixture',repairsCents:null,arvCents:null,businessPhone:null,fetchedAt:null});
  assert.match(html,/\$162,270\.50/);assert.match(html,/\$2,000\.00/);
  assert(!/\$152,270\.50|\$10,000|Purchase contract<\/dt>|Assignment fee<\/dt>|fee shown above/.test(html));
 }
});

test('compact presentation is selected only by the trusted bound call policy',async()=>{
 const base=calculateAutomaticCallOffer({party:'buyer',buyer},{},now);
 for(const contextPolicy of [undefined,'automatic_offer_v14',buyerConversationPolicy,buyerAnswerPolicy,buyerValidatedPolicy,buyerSpeakingPolicy]){
  const result=await automaticCallOffer('a'.repeat(64),{action:'get_offer',conversationId:'conv_fixture'},{db:async()=>({party:'buyer',buyer,contextPolicy}),bind:async()=>assert.fail(),verifyInput:async()=>false,now:()=>now});
  const {instruction,...facts}=result,{instruction:oldInstruction,...oldFacts}=base;
  assert.deepEqual(facts,oldFacts,'All authoritative facts remain unchanged');
  assert.equal(instruction,[buyerConversationPolicy,buyerAnswerPolicy,buyerValidatedPolicy,buyerSpeakingPolicy].includes(contextPolicy)?' '+buyerConversationToolInstruction:oldInstruction);
 }
 const seller={party:'seller',quoteAllowed:true,priceCents:100,instruction:'Seller instructions'};assert.equal(buyerConversationResult(seller),seller);
 for(const patch of [{reserved:true},{closingDate:'2026-10-01'},{askingPriceCents:0}]){
  const original=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,...patch}},{},now),projected=buyerConversationResult(original);
  const {instruction,...facts}=projected,{instruction:oldInstruction,...oldFacts}=original;
  assert.deepEqual(facts,oldFacts);assert.equal(projected.quoteAllowed,false);assert.equal(projected.viewingAllowed,false);
  assert(!/Read spokenOffer exactly and completely/.test(instruction));
 }
});
