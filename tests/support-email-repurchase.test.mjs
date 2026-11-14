import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportEmailRepurchaseReply} from '../lib/support-email-repurchase.ts';
const user=content=>({role:'user',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional-test-key';process.env.ICASH_SUPPORT_AI_MODEL='fictional-test-model';
let calls=0;const deny=async()=>{calls++;throw Error('External model calls forbidden');};
for(const kind of ['access','account'])for(const handedOff of [false,true])for(const prior of ['I paid but the sign-in email is inaccessible.','I paid and no sign-in code arrived.']){
 const r=await replyToSupport({kind,handedOff,allowAI:true,evidence:[],messages:[user(prior),user('My relay email is unavailable. Please refund the purchase so I can buy again with the right email.')]},deny);
 assert.match(r.reply,/ownership/i);
 assert.match(r.reply,/do not pay again|don’t pay again/i);
 assert.match(r.reply,/not approved or issued a refund/i);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);
}
assert.equal(calls,0,'deterministic recovery must not call an external model');
for(const q of [
 'I cannot change my temporary email. Could you refund me so I can buy it again?',
 'Can I get my money back and purchase again using a different checkout email?',
])assert.ok(supportEmailRepurchaseReply(q));
for(const q of [
 'I do not want a refund or to buy again with a new email.',
 'I am not asking for a refund. Can I buy again with another email?',
 'I want a refund but will not buy again with another email.',
 'Hypothetically, could someone get a refund and buy again with a different email?',
 'My friend wants a refund to buy again with a different email.',
 'The seller wants a refund and to buy again with another email.',
 'My wrong email needs correcting.',
 'Refund my work credits.',
 'The refund arrived and I want to buy again with a new email.',
 'Access works; no refund. I will not buy again using another email.',
])assert.equal(supportEmailRepurchaseReply(q),null,q);
for(const kind of ['access','account']){
 const messages=[user('Please refund my purchase so I can buy again using a different email.'),{role:'operator',content:'The purchase is still under ownership review; no refund or email correction is confirmed.'},user('Where do I find the course?')];
 const r=await replyToSupport({kind,messages,evidence:[]},async()=>{throw Error('External model calls forbidden');});
 assert.doesNotMatch(r.reply,/You’re asking for a refund so you can purchase again/);
 assert.match(r.reply,/course/i);
}
for(const finding of ['The refund was issued. Access is still pending.','The checkout email has been corrected; access remains unconfirmed.'])assert.equal(supportEmailRepurchaseReply('Please refund me so I can buy again with a different email.',finding),null);
console.log('PASS email repurchase: account/guest, handoff, denied/hypothetical requests, later operator findings and topic changes.');
