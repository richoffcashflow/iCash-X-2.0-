import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportRenewalCancellationRequested} from '../lib/support-policy.ts';
const user=content=>({role:'user',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let modelCalls=0;
const ask=(kind,q)=>replyToSupport({kind,messages:[user(q)]},async()=>{modelCalls++;throw Error('No paid model');});
for(const kind of ['account','access']){
 for(const q of ['How do I delete my account and stop future charges to my card?','Delete my account and make sure the app does not charge my card next month.','Delete my account and stop billing me.','Please remove my account and prevent the next renewal.']){
  const r=await ask(kind,q);assert.match(r.reply,/Cancel subscription/);assert.match(r.reply,/account deletion/);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
  assert.doesNotMatch(r.reply,/(?:I|we)(?: have|’ve|'ve)? (?:deleted|cancelled|canceled)|renewals have stopped/i);
 }
 const blocked=await ask(kind,'Delete my account and stop billing me. I cannot sign in.');assert.match(blocked.reply,/stop future renewals/);assert.doesNotMatch(blocked.reply,/sign in and open|open the workspace account menu/i);
 const noCancel=await ask(kind,'Delete my account but do not stop billing me.');assert.doesNotMatch(noCancel.reply,/Cancel subscription/);
 const past=await ask(kind,'Delete my account. I already stopped billing.');assert.doesNotMatch(past.reply,/Cancel subscription/);
}
for(const q of ['The app does not charge my card.','My card is not charging.','I already stopped billing.','Do not stop billing me.','I do not want you to stop billing me.','Why did you stop billing me?'])assert.equal(supportRenewalCancellationRequested(q),false,q);
assert.equal(modelCalls,0);
console.log('PASS separate deletion and stop-renewal questions, sign-in failure, negation and past actions; offline only');
