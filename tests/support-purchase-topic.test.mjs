import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportVipPurchaseReply} from '../lib/support-purchase-help.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const initial=[user('I purchased the software but typed the wrong checkout email, so I cannot sign in.'),assistant('The purchase needs ownership verification before the checkout email can be corrected.')];
const mistaken=[...initial,user('I have a screenshot from the VIP webinar after checkout.'),assistant('Email the VIP purchase receipt so its product can be verified.')];
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let modelCalls=0;
const denyPaid=async()=>{modelCalls++;throw Error('Paid model calls forbidden');};
try {
for(const kind of ['account','access']){
 for(const [history,q] of [
  [initial,'The correct email is [email removed]. I have a screenshot showing the VIP session after checkout and the payment.'],
  [mistaken,'This was for regular software access, not VIP. I already purchased it.'],
  [mistaken,'I bought the software, not VIP, and the checkout email is incorrect.'],
  [mistaken,'I bought Standard software, not VIP. My checkout email is wrong and I did not receive a receipt.'],
  [[...mistaken,user('I bought Standard software, not VIP.'),assistant('The purchase still needs ownership review.')],'I just emailed the screenshots.'],
 ]){
  const before=modelCalls;
  const r=await replyToSupport({kind,messages:[...history,user(q)],evidence:[],handedOff:true},denyPaid);
  assert.equal(modelCalls,before,'Ownership review must bypass model calls');
  assert.match(r.reply,/ownership|checkout email/i,q);
  assert.doesNotMatch(r.reply,/VIP purchase receipt|confirmed 2.0 VIP|verify that VIP purchase|request one fresh code/i,q);
  if(q.includes('did not receive a receipt')){assert.match(r.reply,/bank or card statement/i);assert.doesNotMatch(r.reply,/email (?:the|your) .*receipt/i);}
  assert.equal(r.status,'open');assert.equal(r.managementReview,true);
  assert.doesNotMatch(r.reply,/email (?:has been|was) changed|access (?:has been|was) restored/i);
 }
 for(const q of ['Could support call me about this case?','Can you email [email removed] when there is an update, or text my number?','Can you email [email removed] when support responds?','Could management text me with an update?','Is there a number I can contact?']){
  const r=await replyToSupport({kind,messages:[...initial,user(q)],evidence:[],handedOff:true},denyPaid);
  assert.match(r.reply,/management review/i);assert.match(r.reply,/this conversation/i);
  assert.doesNotMatch(r.reply,/eligible sellers|outreach hours|9 AM|will (?:call|email|text) you/i);
  assert.equal(r.status,'open');
 }
 const billing=await replyToSupport({kind,messages:[...initial,user('I was charged twice. Could support call me about this case?')],evidence:[],handedOff:true},denyPaid);
 assert.match(billing.reply,/duplicate-charge|two charges|statement/i,'Keep the separate payment investigation');
 for(const q of ['How do I call a seller?','How do I buy VIP?','I paid for 2.0 VIP and it is not showing.','Cancel my subscription.','I am cancelling my subscription because my checkout email is wrong.']){
  const r=await replyToSupport({kind,messages:[...initial,user(q)],evidence:[]},denyPaid);
  assert.doesNotMatch(r.reply,/checkout email can be corrected|earlier proof details/i,q);
 }
 for(const history of [[...initial,{role:'operator',content:'The purchase has been matched. A separate browser error is still being checked.'}], [...initial,user('How do I call a seller?'),assistant('Use the Call control.')], [...initial,user('It worked, I am signed in now.'),assistant('Glad that worked.')]]){
  const r=await replyToSupport({kind,messages:[...history,user('I have a screenshot.')],evidence:[]},denyPaid);
  assert.doesNotMatch(r.reply,/checkout email can be corrected|earlier proof details/i);
 }
}
for(const q of ['I did not buy VIP.','I bought Standard, not VIP.','This is not for VIP access, I paid for regular access.'])assert.equal(supportVipPurchaseReply({kind:'access',messages:[...mistaken,user(q)]}),null,q);
assert.match(supportVipPurchaseReply({kind:'access',messages:[user('I paid for VIP but it is not active.')]}).reply,/VIP/);
assert.equal(supportVipPurchaseReply({kind:'access',messages:[user('I paid for VIP but it is locked.'),{role:'operator',content:'The receipt is for regular access; ownership is still being checked.'},user('Yes, I already sent it.')]}),null);
} finally {process.env=env;}
console.log('PASS purchase topic: preserve ownership review, explicit product correction, proof and support contact; retain topic/operator/success boundaries.');
