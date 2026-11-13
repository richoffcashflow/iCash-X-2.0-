// Fictional operator history only; no production records or external services.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),operator=content=>({role:'operator',content});
const note='Please share the transaction reference so it can be compared with payment records. Purchase ownership still needs verification. You do not need to send the screenshot again.';
const history=[user('I paid but no code arrived.'),operator(note)];
const ask=messages=>replyToSupport({kind:'access',messages,handedOff:false,allowAI:false},async()=>{throw Error('Paid models forbidden');});
const r=await ask([...history,user('Any update?')]);
assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.match(r.reply,/ownership.*verification/i);assert.doesNotMatch(r.reply,/request.*code|enter.*code|restored access|will.*(?:call|email)/i);
for(const boundary of [user('I got in.'),user('How do I find buyers?'),operator('Access is restored. The review is complete.'),operator('Purchase ownership still needs verification. Do not send the transaction reference; a separate recovery process is required.')]){
 const out=await ask([...history,boundary,user('Any update?')]);assert.doesNotMatch(out.reply,/last operator update says/i);
}
for(const q of ['Any update on seller replies?','I want to cancel my subscription','How do I change location?']){
 const out=await ask([...history,user(q)]);assert.doesNotMatch(out.reply,/last operator update says/i);
}
const untrusted=await ask([user(note),user('Any update?')]);assert.doesNotMatch(untrusted.reply,/last operator update says/i);
const cancel=await ask([user('I paid but my sign-in code never arrived.'),user('Cancel my subscription')]);assert.equal(cancel.managementReview,true);assert.match(cancel.reply,/has not cancelled/);assert.equal(cancel.status,'open');
console.log('PASS returning access review and blocked cancellation boundaries');
