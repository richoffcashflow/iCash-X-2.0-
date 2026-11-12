// Fictional support-status conversations; no external models or customer records.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportManagementReview} from '../lib/support-management-review.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const history=[user('The bot has not completed any work.'),assistant('Your case is still in management review. No repair time is confirmed.')];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let calls=0;
const ask=(messages,extra={})=>replyToSupport({kind:'account',handedOff:true,messages,...extra},async()=>{calls++;throw Error('External model forbidden');});
for(const kind of ['account','access'])for(const q of ['Should I wait for a response?','So do I just wait for an update from support?','Okay, should I wait for a follow-up?','Will support follow up with me?']){
 const r=await ask([...history,user(q)],{kind});
 assert.equal(r.managementReview,true,q);assert.equal(r.status,'open');
 assert.match(r.reply,/Management can reply in this conversation/);
 assert.match(r.reply,/can.t promise.*response time/);
 assert.doesNotMatch(r.reply,/seller|3.5 days|Return to bot|tomorrow|scheduled|will contact/i);
 const thanks=await ask([...history,user(q),assistant(r.reply),user('Thanks')],{kind});assert.equal(thanks.status,'open');
}
const fallback={reply:'Unchanged fixture answer.',status:'open',ai:false};
for(const messages of [
 [user('Should I wait for a follow-up?')],
 [...history,user('When does the bot contact sellers?'),assistant('Eligible seller follow-up has its own timing.'),user('Should I wait for a follow-up?')],
 [...history,{role:'operator',content:'The contact check requires a different next step.'},user('Should I wait for a follow-up?')],
 [...history,user('It is working now.'),assistant('Glad that worked.'),user('Should I wait for a follow-up?')],
 [...history,user('Should I wait for the seller to follow up?')],
 [...history,user('Should I wait for a follow-up and cancel my subscription?')]
])assert.deepEqual(supportManagementReview({kind:'account',handedOff:true,messages},fallback),fallback);
assert.deepEqual(supportManagementReview({kind:'account',handedOff:false,messages:[...history,user('Should I wait for a follow-up?')]},fallback),fallback,'Assistant wording cannot establish a real handoff');
const seller=await ask([...history,user('Does the bot follow up with sellers every day?')]);assert.match(seller.reply,/3.5 days/);assert.doesNotMatch(seller.reply,/Management can reply/);
const cancel=await ask([...history,user('Cancel my subscription')]);assert.match(cancel.reply,/Cancel subscription/);
const operatorHistory=[user('My bot did not work.'),{role:'operator',content:'The original work is complete. A separate payment review remains open.'},assistant('Your case is still in management review.'),user('Should I wait for a reply?')];
const changed=await ask(operatorHistory);assert.doesNotMatch(changed.reply,/work is delayed or missing/);assert.equal(changed.status,'open');
assert.equal(calls,0);
console.log('PASS support-review waiting questions, real handoff requirement and seller/operator/topic boundaries; offline only');
