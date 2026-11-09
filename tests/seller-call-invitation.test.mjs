import assert from 'node:assert/strict';
import {planSellerTextOffer,sellerCallInvitation} from '../lib/seller-text-offer.ts';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';
import {sellerRequestsPrice} from '../lib/seller-conversation-efficiency.ts';
import {sellerOfferQualification} from '../lib/seller-offer-qualification.ts';
import {readFileSync} from 'node:fs';
globalThis.fetch=async()=>{throw Error('No provider calls in offline replay');};
let id=0;
const incoming=body=>({id:String(++id),direction:'incoming',state:'received',body,providerId:null});
const outgoing=(body,action)=>({id:String(++id),direction:'outgoing',state:'delivered',providerId:'receipt-'+id,body,action});
const base={accountId:'fixture-account',jobId:'fixture-job',threadId:'fixture-thread',dealId:'fixture-deal',screeningId:'fixture-screen',phone:'+12125550123',ownerUserId:'fixture-owner',ownerEmail:'fixture@example.invalid',principal:'Fixture Homes',address:'123 Example Road',snapshot:{},terms:{},offerState:null,offerVersion:0,fingerprint:'source-fingerprint'};
const context=(messages,extra={})=>({...base,messages,sourceId:messages.at(-1).id,...extra});
const history=[outgoing('Do you own 123 Example Road?'),incoming('Yes'),outgoing('Are you looking to sell the property?'),incoming('Yes')];
const ready=context(history,{callInvitationAllowed:true});
let p=planSellerTextOffer(ready);
assert.equal(p.action,'invite_call');assert.equal(p.body,sellerCallInvitation);assert.equal(p.state.acceptedPriceCents,null);
assert(!/booked|calling you|scheduled/i.test(p.body));
for(const eligibility of [undefined,false,null,'true'])assert.notEqual(planSellerTextOffer({...ready,callInvitationAllowed:eligibility}).action,'invite_call');
assert.equal(planSellerTextOffer(context([outgoing('Do you own 123 Example Road?'),incoming('Yes')],{callInvitationAllowed:true})).action,'qualify_interest','Ownership alone does not invite a sales call');
const invite=outgoing(p.body,p.action);
for(const answer of ['No','Nope','Just text me','Text only','I prefer texting']){
 const next=planSellerTextOffer(context([...history,invite,incoming(answer)],{offerState:p.state,callInvitationAllowed:true}));
 assert.equal(next.kind,'message',answer);assert.equal(next.action,'qualify_situation',answer);assert(!/call|time to talk|good time/i.test(next.body),answer);
}
for(const answer of ['No',"I can't talk, just text me"]){
 const old=planSellerTextOffer(context([...history,outgoing(sellerCallInvitation),incoming(answer)],{offerState:p.state,callInvitationAllowed:true}));
 assert.equal(old.action,'qualify_situation',answer+' after historical delivered invitation');
}
const yes=planSellerTextOffer(context([...history,invite,incoming('Yes')],{offerState:p.state,callInvitationAllowed:true}));
assert.equal(yes.action,'invite_call_time');assert(!/calling|booked|scheduled/i.test(yes.body));
for(const answer of ['STOP','Not interested','Please do not call me'])assert.equal(planSellerTextOffer(context([...history,invite,incoming(answer)],{offerState:p.state,callInvitationAllowed:true})).kind,'review');
const afterDetail=planSellerTextOffer(context([...history,invite,incoming('It needs paint')],{offerState:p.state,callInvitationAllowed:true}));
assert.notEqual(afterDetail.action,'invite_call','Never repeat an unanswered invitation');
assert.notEqual(planSellerTextOffer(context([...history,outgoing('When is a good time to talk about a cash offer?'),incoming('It needs paint')],{callInvitationAllowed:true})).action,'invite_call');
for(const request of ['How much','How much?','How much for it?','What is the offer?']){
 assert(sellerRequestsPrice(request));
 const plan=planSellerTextOffer(context([...history,incoming(request)],{callInvitationAllowed:true}));
 assert.equal(plan.action,'qualify_situation');assert.match(plan.body,/An offer depends/);
}
for(const request of ['How much is rent?','How much do repairs cost?','The buyer said how much','How much? Stop texting me.'])assert.equal(sellerRequestsPrice(request),false,request);
const soldHistory=[outgoing('Do you own 123 Example Road?'),incoming('Sold'),incoming('How much')];
let sold=planSellerTextOffer(context(soldHistory,{callInvitationAllowed:true}));
assert.equal(sold.action,'clarify_sale_status');assert.match(sold.body,/mentioned it was sold/);assert.equal(sold.state.acceptedPriceCents,null);
const clarify=outgoing(sold.body,sold.action);
const corrected=planSellerTextOffer(context([...soldHistory,clarify,incoming('I still own it')],{callInvitationAllowed:true,offerState:sold.state}));
assert.equal(corrected.action,'invite_call','Explicit ownership correction resolves ambiguity; prior price question preserves interest');
const closed=planSellerTextOffer(context([...soldHistory,clarify,incoming('I sold it')],{callInvitationAllowed:true,offerState:sold.state}));
assert.equal(closed.kind,'review');assert.equal(closed.reason,'property_already_sold');
for(const text of ['It was already sold','I no longer own it'])assert.equal(planSellerTextOffer(context([...history,incoming(text)],{callInvitationAllowed:true})).reason,'property_already_sold');
const oldSaleQuote=planSellerTextOffer(context([...history,incoming('My neighbor said sold')],{callInvitationAllowed:false}));assert.notEqual(oldSaleQuote.action,'clarify_sale_status');
for(const state of ['accepted','dispatching']){
 const uncertain=planSellerTextOffer(context([...history,{...invite,state,updatedAt:new Date().toISOString()},incoming('Yes')],{callInvitationAllowed:true}));assert.equal(uncertain.kind,'wait');
}
const voice=sellerOfferQualification({transcript:[{role:'agent',message:'Are you the owner?'},{role:'user',message:'Yes'}]});assert(voice.missing.includes('availability'),'Voice availability policy stays intact');
const sms=sellerOfferQualification({transcript:[{role:'agent',message:'Are you the owner?'},{role:'user',message:'Yes'}]},[],'sms');assert(!sms.missing.includes('availability'));
// The service derives the flag from the existing current channel predicate,
// never from a caller field, context JSON, or draft. Read failure keeps SMS useful.
for(const eligibility of [true,false,'true','error']){
 let saved,read=0,dispatch=0;
 const result=await processSellerTextOffer(ready,{
  db:async(path,method,body)=>{
   if(path==='rpc/icash_seller_prior_call_context')return [];
   if(path==='rpc/icash_outreach_voice_current'){assert.deepEqual(body,{p_account:base.accountId});read++;if(eligibility==='error')throw Error('read unavailable');return eligibility;}
   if(path==='rpc/icash_seller_conversation_context')return {sellerConversation:true};
   if(path.startsWith('icash_contact_permissions?')){assert(path.includes('screening_id=eq.fixture-screen'));assert(path.includes('phone=eq.%2B12125550123'));return [{id:'permission'}];}
   if(path==='rpc/icash_seller_voice_permission_current'){assert.deepEqual(body,{p_account:base.accountId,p_permission:'permission'});return true;}
   assert.equal(path,'rpc/icash_save_seller_text_offer');saved=body;return {messageId:'saved-message'};
  },dispatch:async()=>{dispatch++;return {status:'fixture-only'};},send:async()=>{throw Error('No agreement authorized');},text:async()=>{throw Error('No agreement authorized');}
 });
 assert.equal(read,1);assert.equal(dispatch,1);assert.equal(result.status,'fixture-only');
 assert.equal(saved.p_plan.action,eligibility===true?'invite_call':'qualify_situation');assert.equal(saved.p_fingerprint,base.fingerprint);
}
const callbackSql=readFileSync(new URL('../config/seller-sms-immediate-callback.sql',import.meta.url),'utf8');
assert(callbackSql.includes("(when|what (date|day|time)|good time|available).*(call|talk)|can (i|we) call"),'Existing immediate request parser recognizes exact invitation');
const continuationSql=readFileSync(new URL('../config/seller-conversation-continuation.sql',import.meta.url),'utf8');
assert(continuationSql.includes("'"+sellerCallInvitation+"'"),'Later availability is bound to actually sent exact question');
// Every readiness component is required, and a source flag cannot bypass it.
for(const failure of ['context','permissions','permission','malformed','read_error']){
 let saved;
 await processSellerTextOffer(ready,{
  db:async(path,method,body)=>{
   if(path==='rpc/icash_seller_prior_call_context')return [];
   if(path==='rpc/icash_outreach_voice_current')return true;
   if(path==='rpc/icash_seller_conversation_context')return failure==='context'?null:{sellerConversation:true};
   if(path.startsWith('icash_contact_permissions?'))return failure==='permissions'?[]:[{id:'bound'}];
   if(path==='rpc/icash_seller_voice_permission_current'){if(failure==='read_error')throw Error('read failed');return failure==='malformed'?'true':false;}
   assert.equal(path,'rpc/icash_save_seller_text_offer');saved=body.p_plan;return {review:true};
  },dispatch:async()=>{throw Error('Unexpected dispatch');},send:async()=>{throw Error('Unexpected signing');},text:async()=>{throw Error('Unexpected delivery');}
 });
 assert.equal(saved.action,'qualify_situation',failure);
}

const ambiguousYes=planSellerTextOffer(context([...soldHistory,clarify,incoming('Yes')],{offerState:sold.state,callInvitationAllowed:true}));
assert.equal(ambiguousYes.action,'clarify_sale_status','Yes cannot answer the either-or sale-status question');
const acceptedThenSold=planSellerTextOffer(context([...history,outgoing('Our cash proposal is $100,000. Does that work?','cash_offer'),incoming('Sold')],{offerState:{textThreadId:base.threadId,quotedPriceCents:10000000,acceptedPriceCents:10000000}}));
assert.equal(acceptedThenSold.action,'clarify_sale_status');assert.equal(acceptedThenSold.state.acceptedPriceCents,null);
console.log('PASS seller call invitation: eligible once, text preference, unanswered/uncertain invitation, opt-outs, exact price questions, sold clarification, service channel gate and no new calling authority.');
