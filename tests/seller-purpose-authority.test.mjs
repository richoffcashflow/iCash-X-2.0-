import assert from 'node:assert/strict';
import {callOfferEvidence,callSellerStatement,callPayoffEvidence} from '../lib/call-offer-evidence.ts';
import {sellerContactPurposeQuestion} from '../lib/seller-contact-purpose.ts';
import {sellerCallContext} from '../lib/seller-call-context.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';

const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const price=7_000_000,revision='a'.repeat(64),input={action:'accept_offer',priceCents:price,quoteRevision:revision};
const receipt={role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,priceCents:price,quoteRevision:revision})}]};
const quote=a('Our cash offer is $70,000. Does that price work?');
const accept=turns=>callOfferEvidence({transcript:turns},input);
const questions=['How can I help?','How may I help you?','What is this about?','What is this for?','Why are you calling?'];
const prefixes=['','Yes, ','Yeah, ','Yep, ','Sure, ','Okay, ','OK, ','Correct, ','Right, ','Absolutely, '];
const purpose=questions.flatMap(q=>prefixes.map(prefix=>prefix+q));
const fillerPurpose=['Um, yes, how can I help?','Well, yeah, what is this for?','Uh, yes, why are you calling?'];
const at=new Date(Date.now()-60_000).toISOString();
const expected={conversationId:'purpose-source',agentId:'purpose-agent',party:'seller'};
for(const message of [...purpose,...fillerPurpose]){
 if(!fillerPurpose.includes(message))assert.equal(sellerContactPurposeQuestion(message),true,message);
 assert.equal(accept([receipt,quote,u(message)]),false,'Purpose must not accept: '+message);
 assert.equal(accept([receipt,quote,u(message),u('Yes.')]),false,'Purpose breaks the pending quote association');
 assert.equal(accept([receipt,quote,u(message),quote,u('Yes.')]),true,'A fresh exact price question can receive real acceptance');
 assert.equal(accept([receipt,quote,u('Yes.'),u(message)]),true,'A pure interruption preserves earlier real acceptance');
 assert.equal(accept([receipt,quote,u('Yes.'),u(message),u('Do not accept. I changed my mind.')]),false,'Later withdrawal remains authoritative');
 const history={threadId:'fixture',messages:[{id:'q',at,direction:'outgoing',body:'Is this the owner of 45 Fixture Lane?'},{id:'a',at,direction:'incoming',body:message}]};
 assert.equal(sellerCallContext({address:'45 Fixture Lane',principal:'Fixture Buyer',assistantName:'Alex',history}).ownershipAlreadyConfirmed,false,'Ownership remains separate: '+message);
 const confirmedHistory={...history,messages:[history.messages[0],{id:'real',at,direction:'incoming',body:'Yes.'},history.messages[1]]};
 assert.equal(sellerCallContext({address:'45 Fixture Lane',principal:'Fixture Buyer',assistantName:'Alex',history:confirmedHistory}).ownershipAlreadyConfirmed,true,'A pure purpose question preserves earlier ownership confirmation');
 for(const question of ['Is this the owner of 45 Fixture Lane?','Would you consider selling the property for a cash offer?']){
  const result=liveConversationResult({conversation_id:expected.conversationId,agent_id:expected.agentId,status:'done',transcript:[a(question),u(message)],analysis:{data_collection_results:{interested:{value:true},interest_quote:{value:message}}}},expected);
  assert.equal(result.contactEvidence,'human_response');assert.equal(result.interested,false,'Purpose is not selling interest');assert.equal(result.optedOut,false);
 }
 const previousInterest=liveConversationResult({conversation_id:expected.conversationId,agent_id:expected.agentId,status:'done',transcript:[a('Would you consider selling the property for a cash offer?'),u('Yes.'),u(message)],analysis:{data_collection_results:{interested:{value:true},interest_quote:{value:'Yes.'}}}},expected);
 assert.equal(previousInterest.interested,true,'A pure purpose question preserves real earlier selling interest');
 const repairs={transcript:[a('What repairs does the property need?'),u(message)]};
 for(const action of ['update_repairs','report_change']){
  const fact={action,sellerStatement:message};
  assert.equal(callOfferEvidence(repairs,fact),false,'Purpose is not a verified material fact');
  assert.equal(callSellerStatement(repairs,fact),null,'Never save the purpose question as property facts');
 }
 assert.equal(callPayoffEvidence({transcript:[a('What is the mortgage payoff balance?'),u(message)]},{action:'report_change',sellerStatement:message}),false);
}
for(const answer of ['Yes.','Yeah, that price works for me.','I agree.','That works.','Yes. I want to close in 30 days.'])assert.equal(accept([receipt,quote,u(answer)]),true,answer);
for(const answer of ['No.','Yes, but I need $80,000.','Yes if you close tomorrow.'])assert.equal(accept([receipt,quote,u(answer)]),false,answer);
assert.equal(callOfferEvidence({transcript:[a('What repairs does the property need?'),u('The roof needs replacement.')]},{action:'update_repairs',sellerStatement:'The roof needs replacement.'}),true);

// Execute the actual offer service against a private in-memory persistence
// boundary. No provider or hosted database calls; a rejected purpose answer
// must not write acceptedPriceCents or advance the saved quote version.
const now=Date.now(),conversationId='conv_purpose',token='b'.repeat(64);
let context={party:'seller',accountId:'fixture-account',dealId:'fixture-deal',address:'45 Fixture Lane',snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',estimated_value:200000,estimated_repair_cost:60000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}},offerState:null,offerVersion:0};
let transcript=[],saves=0;
const d={now:()=>now,bind:async()=>{},verifyQualification:async()=>({ready:true}),verifyInput:async i=>callOfferEvidence({transcript},i),db:async(path,method,body)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 assert.equal(path,'rpc/icash_save_call_offer');assert.equal(body.p_expected_version,context.offerVersion);
 context.offerState=structuredClone(body.p_state);context.offerVersion++;saves++;return true;
}};
const quoted=await automaticCallOffer(token,{action:'get_offer',conversationId},d);
assert.equal(quoted.priceCents,price,JSON.stringify(quoted));assert.equal(saves,1);
const saved=structuredClone(context);
for(const message of ['Yes, how can I help?','How may I help you?','Um, yes, what is this for?']){
 transcript=[quote,u(message)];
 const response=await automaticCallOffer(token,{...input,conversationId,quoteRevision:quoted.quoteRevision},d);
 assert.equal(response.reason,'acceptance_confirmation_required');assert.equal(saves,1);assert.deepEqual(context,saved);
}
transcript=[quote,u('Yes.')];
const accepted=await automaticCallOffer(token,{...input,conversationId,quoteRevision:quoted.quoteRevision},d);
assert.equal(accepted.status,'verbally_accepted');assert.equal(context.offerState.acceptedPriceCents,price);assert.equal(saves,2);
console.log('PASS seller purpose authority: 53 complete purpose replies cannot accept price, ownership, interest or material facts; pending-question interruption, prior acceptance, fresh confirmations and actual service save boundary preserved.');
