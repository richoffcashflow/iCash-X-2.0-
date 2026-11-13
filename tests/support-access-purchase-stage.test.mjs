// Fictional purchase-stage replays; no live identities, receipts or model calls.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportCurrentStepReply} from '../lib/support-current-step.ts';
import {supportCodeDelivery} from '../lib/support-code-delivery.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const history=[user('My email sign-in code has not arrived.'),assistant('Does the email on your purchase receipt match?'),user('Please escalate my access issue.'),assistant('I have flagged this conversation for management review.')];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let calls=0;
const ask=(messages,extra={})=>replyToSupport({kind:'access',handedOff:true,messages,...extra},async()=>{calls++;throw Error('External model forbidden');});
for(const q of ['I cannot find an email receipt.','I do not see a purchase receipt.','I don’t have a receipt.']){
 const r=await ask([...history,user(q)]);
 assert.match(r.reply,/already completed.*purchase|already paid/i,q);
 assert.match(r.reply,/first time/i);assert.doesNotMatch(r.reply,/bank|statement|enter.*code|check.*receipt/i);assert.equal(r.status,'open');
}
const missing=[...history,user('I cannot find an email receipt.'),assistant('Have you already completed a purchase, or are you signing up for the first time?')];
const destination=await ask([...missing,user('I want to sign up with my preferred email address.')]);
assert.match(destination.reply,/already completed.*purchase|already paid/i);assert.doesNotMatch(destination.reply,/email (?:has been|was) changed|access (?:has been|is) restored/i);
for(const q of ['I already paid, but I am having trouble getting the email code.','I paid already and I am having problems with code sending to my email.']){
 const r=await ask([...missing,{role:'operator',content:'No receipt arrived. Have you already completed a purchase? No email or access has changed.'},user(q)]);
 assert.match(r.reply,/payment date and amount|date and amount.*statement/i,q);assert.doesNotMatch(r.reply,/enter.*code|press.*sign.in|check.*receipt/i);assert.equal(r.status,'open');
}
const supplied=await ask([...history,user('I paid $47 yesterday but never received a receipt.'),assistant('Those details still need to be matched to a purchase.'),user('I still cannot find the receipt.')]);
assert.match(supplied.reply,/details.*matched/i);assert.doesNotMatch(supplied.reply,/what payment date and amount/i);
const unpaid=await ask([...missing,user('I have not paid. My email code has not arrived.')]);
assert.doesNotMatch(unpaid.reply,/bank|statement|payment date and amount/i);
const found=await ask([...missing,user('I found my receipt, but my email code still has not arrived.')]);
assert.doesNotMatch(found.reply,/receipt.*still missing|no receipt arrived/i);
assert.equal(supportCurrentStepReply({kind:'access',messages:[user('I cannot find the seller contract receipt.')]}),null);
for(const q of ['Where is my seller contract?','How can I change my custom voice?','I want a refund.','Cancel my subscription.']){
 const r=await ask([...missing,user(q)]);assert.doesNotMatch(r.reply,/already completed.*purchase|first time/i,q);
}
const checked=await ask([...missing,{role:'operator',content:'The payment was matched. The checkout email differs and verified recovery is pending.'},user('I do not see a receipt.')]);
assert.match(checked.reply,/payment check already recorded/i);assert.doesNotMatch(checked.reply,/already completed.*purchase|what payment date/i);
assert.equal(supportCurrentStepReply({kind:'account',messages:[user('I do not see a receipt.')]}),null);
assert.equal(supportCodeDelivery([user('I am having trouble sending the seller code.')]),'unknown');
assert.equal(supportCodeDelivery([user('My email code arrived. I am having trouble entering it.')]),'received');
assert.equal(supportCodeDelivery([user('There are no problems with email code delivery.')]),'unknown');
assert.equal(supportCodeDelivery([user('My source code has problems with code sending to email.')]),'unknown');
assert.equal(calls,0);console.log('PASS missing receipt, purchase-stage clarification and code-delivery boundaries; offline only');
