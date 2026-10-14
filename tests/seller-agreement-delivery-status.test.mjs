import assert from 'node:assert/strict';
import {sellerAgreementAction} from '../lib/seller-agreement-service.ts';

// Creating a phone-link-only agreement does not send a text. Status must read
// the exact seller's message receipt, without causing a resend or new contract.
const scope={callKey:'outbound:fixture',accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12125550199'};
const envelope={id:'envelope',state:'awaiting_counterparty',test_mode:false,terms:{},recipients:[{id:'1',name:'Jane Seller',phone:scope.phone},{id:'2',name:'Fixture Buyer'}]};
let delivery=[],messages=[],signatureStatus='awaiting_counterparty',recipientMatches=true,receiptReads=0;
const forbidden=async()=>assert.fail('A status check must not send, create, or sign anything');
const deps={
 bind:async()=>{},history:forbidden,send:forbidden,text:forbidden,
 refresh:async()=>({status:signatureStatus}),
 db:async(path,method)=>{
  if(path==='rpc/icash_seller_agreement_call_context')return scope;
  assert.equal(method,undefined,'Only the read-only call-context RPC uses POST');
  if(path.startsWith('icash_signing_envelopes?'))return [{...envelope,recipients:recipientMatches?envelope.recipients:[{...envelope.recipients[0],phone:'+12125550888'},envelope.recipients[1]]}];
  if(path.startsWith('icash_contract_text_deliveries?')){
   assert.match(path,/account_id=eq.account&envelope_id=eq.envelope&signer_id=eq.1&/);
   receiptReads++;return delivery;
  }
  if(path.startsWith('icash_text_messages?')){
   assert.match(path,/account_id=eq.account&id=eq.exact-message&direction=eq.outgoing&/);
   receiptReads++;return messages;
  }
  assert.fail(path);
 },
};
const status=()=>sellerAgreementAction('a'.repeat(64),{action:'status',conversationId:'conv_fixture'},deps);

let result=await status();
assert.equal(result.sent,false);assert.equal(result.status,'delivery_needs_review');assert.equal(result.deliveryStatus,'not_queued');
assert.match(result.instruction,/Do not say it was sent or ask the seller to finish signing/);
delivery=[{message_id:'exact-message'}];
for(const state of ['ready','dispatching','needs_review','failed']){
 messages=[{state,provider_id:null}];result=await status();
 assert.equal(result.sent,false,`${state} is not provider acceptance`);
 assert.equal(result.status,['ready','dispatching'].includes(state)?'delivery_pending':'delivery_needs_review');
}
messages=[{state:'accepted',provider_id:null}];assert.equal((await status()).sent,false,'A state flag without a provider receipt cannot establish a send');
messages=[{state:'accepted',provider_id:'provider-message'}];result=await status();
assert.equal(result.sent,true);assert.equal(result.status,'signature_pending');assert.match(result.instruction,/delivery is not confirmed/);
messages=[{state:'delivered',provider_id:'provider-message'}];result=await status();
assert.equal(result.sent,true);assert.equal(result.deliveryStatus,'delivered');assert.match(result.instruction,/seller has not confirmed receiving it/);
signatureStatus='needs_review';messages=[];result=await status();
assert.equal(result.status,'needs_review');assert.equal(result.sent,false);

// Independently verified signatures remain valid even if a delivery record is
// missing (for example, the signer used a link supplied in an approved handoff).
delivery=[];const before=receiptReads;
for(const [verified,expected] of [['customer_signature_needed','seller_signed'],['completed','fully_signed']]){
 signatureStatus=verified;result=await status();assert.equal(result.status,expected);assert.equal(result.sent,true);
}
assert.equal(receiptReads,before,'Verified signatures do not depend on a missing text receipt');
recipientMatches=false;result=await status();assert.equal(result.status,'not_sent');assert.equal(result.sent,false);
console.log('PASS contract status distinguishes prepared, queued, accepted, delivered and signed; no false send claims, resends, or provider calls.');
