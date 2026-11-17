import assert from 'node:assert/strict';
import {sellerDialogueState,sellerOfferQualification,boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {sellerInterestQuote} from '../lib/seller-interest-evidence.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';

globalThis.fetch=async()=>{throw Error('NO NETWORK: fictional seller conversation fixtures only');};
const a=message=>({role:'agent',message}),u=message=>({role:'user',message,sourceId:'fixture-reply',at:'2026-11-17T12:00:00Z'});
const question='Would you be interested in selling your property?';
const replies=["I'm interested.",'I’m interested.','Interested.',"I'm open to selling.","I'm open to a cash offer."];
for(const channel of ['voice','sms']){
 for(const answer of replies){
  const transcript=[a(question),u(answer)];
  assert.equal(sellerInterestQuote(transcript),answer,'the existing canonical evidence matcher already recognizes '+answer);
  const state=sellerDialogueState({transcript},[],channel);
  assert.equal(state.facts.interest?.value,true,channel+' should remember '+answer);
  assert.equal(state.facts.interest?.quote,answer,'preserve the original words');
  assert.equal(state.facts.interest?.sourceId,'fixture-reply');
  assert.equal(state.facts.interest?.channel,channel);
  assert(!state.qualification.missing.includes('interest'),'do not repeat the answered selling question');
  assert(state.qualification.missing.includes('ownership'),'selling interest is not ownership');
  assert(state.qualification.missing.includes('condition'),'selling interest is not property qualification');
  assert.equal(state.priceRequested,false,'the added evidence is not a price request or acceptance');
 }
 for(const answer of ["I'm interested.",'Interested.']){
  const state=sellerDialogueState({transcript:[a('Are you looking to sell the property?'),u(answer)]},[],channel);
  assert.equal(state.facts.interest?.value,true,'existing alternate selling question is supported');
 }
 for(const answer of ['Interested in hearing more.','Maybe interested.',"I'm interested if you pay a million dollars.","I'm open to a cash offer on my other property.",'For the right price.','My wife said she is interested.','“I’m interested.”','Interested?']){
  const state=sellerDialogueState({transcript:[a(question),u(answer)]},[],channel);
  assert.notEqual(state.facts.interest?.value,true,'ambiguous, conditional or quoted words are not confirmed interest: '+answer);
 }
 for(const otherQuestion of ['Are you the owner?','Is this a good time to talk?','Would you like more information?','What repairs does it need?']){
  const state=sellerDialogueState({transcript:[a(otherQuestion),u("I'm interested.")]},[],channel);
  assert.notEqual(state.facts.interest?.value,true,'a short reply needs a selling question: '+otherQuestion);
  assert.notEqual(state.facts.ownership?.value,true,'the contraction is not generic ownership affirmation');
 }
 const prior={transcript:[a(question),u("I'm interested.")],channel};
 const reused=sellerOfferQualification({transcript:[a('What repairs does it need?'),u('A new roof.')]},[prior],channel);
 assert(!reused.missing.includes('interest'),'carry the confirmed answer into later conversation');
 for(const refusal of ['I am not interested in selling.','Stop contacting me.']){
  assert.equal(sellerOfferQualification({transcript:[u(refusal)]},[prior],channel).stop,true,'later refusal always wins');
 }
 const correction=sellerOfferQualification({transcript:[a(question),u("I'm interested."),u('Actually, I do not want to sell.')]},[],channel);
 assert.equal(correction.stop,true,'positive evidence cannot override a refusal in the same conversation');
 const differentSpeaker=sellerOfferQualification({transcript:[u("I'm his son.")]},[{transcript:qualifiedSellerTurns},prior],channel);
 assert(differentSpeaker.missing.includes('ownership'));
 assert(differentSpeaker.missing.includes('interest'),'a new speaker cannot inherit the seller’s answer');
}
// The actual return-call service must reuse the source-backed SMS answer.
const binding={accountId:'fixture-account',dealId:'fixture-deal',screeningId:'fixture-screening',phone:'+12125550123'};
let reads=0;
const bound=await boundSellerQualification(async(path,method,args)=>{
 reads++;
 assert.equal(path,'rpc/icash_seller_memory_context');
 assert.equal(method,'POST');
 assert.deepEqual(args,{p_account:binding.accountId,p_screening:binding.screeningId,p_phone:binding.phone});
 return {binding,fingerprint:'fixture-fingerprint',complete:true,cached:{version:'seller-memory-v1'},conversations:[
  {sourceId:'fixture-sms',at:'2026-11-17T12:00:00Z',channel:'sms',transcript:[a(question),u("I'm interested.")]},
 ]};
},binding,{transcript:[a('What repairs does it need?'),u('A new roof.')]});
assert.equal(reads,1);
assert(!bound.missing.includes('interest'),'return-call service preserves the source-backed text answer');
assert(bound.missing.includes('ownership'));
console.log('PASS seller interest qualification: canonical affirmative phrases, original quotes, voice/SMS reuse, missing ownership/property facts, ambiguity, corrections and speaker changes.');
