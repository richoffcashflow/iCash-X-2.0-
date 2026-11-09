import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const operator=content=>({role:'operator',content});
const noModel=async()=>{throw Error('Deletion review must not call a paid model');};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture-not-a-key';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
for(const kind of ['account','access']){
 for(const question of ['Please delete my account','I need my account deleted','Remove my iCash X account','I cannot sign in. Delete my account.']){
  const answer=await replyToSupport({kind,messages:[user(question)]},noModel);
  assert.equal(answer.managementReview,true);
  assert.equal(answer.status,'open');
  assert.match(answer.reply,/account deletion/i);
  assert.doesNotMatch(answer.reply,/describe that request|sign in and open|email address|billing address|phone number/i);
  assert.match(answer.reply,/haven’t confirmed/);
  assert.doesNotMatch(answer.reply,/(?:I|we)(?: have|’ve|'ve)? (?:deleted|cancelled|canceled)/i);
 }
 const history=[user('Please delete my account'),operator('Your subscription is canceled. Account deletion remains unresolved; you do not need to resend your details.')];
 const repeated=await replyToSupport({kind,messages:[...history,user('Please delete my account')]},noModel);
 assert.equal(repeated.managementReview,true);assert.match(repeated.reply,/earlier operator/i);
 for(const question of ['Any update?','I already gave you my details','I gave you the email','I can’t get to the menu','Thank you']){
  const answer=await replyToSupport({kind,messages:[...history,user(question)]},noModel);
  assert.equal(answer.managementReview,true);assert.match(answer.reply,/account deletion/i);
 }
 for(const question of ["Do not delete my account","I don't want to delete my account",'I no longer want my account deleted','Cancel my account deletion request','What if I wanted to delete my account?','Would cancellation delete my account?','Delete my account number from this draft','Delete a property','Cancel my subscription','Where is the course?']){
  const answer=await replyToSupport({kind,messages:[user(question)]},noModel);
  assert.notEqual(answer.managementReview,true,question);
 }
 const changed=await replyToSupport({kind,messages:[...history,user('Where is the course?')]},noModel);
 assert.match(changed.reply,/course/i);assert.doesNotMatch(changed.reply,/account deletion/i);
 const later=await replyToSupport({kind,messages:[...history,user('Where is the course?'),{role:'assistant',content:changed.reply},user('Any update?')]},noModel);
 assert.doesNotMatch(later.reply,/account deletion/i);
 const payment=await replyToSupport({kind,messages:[user('I was charged twice. Delete my account.')]},noModel);
 assert.match(payment.reply,/duplicate-charge report/i);assert.match(payment.reply,/account deletion/i);assert.equal(payment.managementReview,true);
 const refund=await replyToSupport({kind,messages:[user('I want a refund and to delete my account.')]},noModel);
 assert.match(refund.reply,/All sales are final/);assert.match(refund.reply,/account deletion/i);assert.equal(refund.status,'open');
 const cancel=await replyToSupport({kind,messages:[user('Cancel my subscription and delete my account.')]},noModel);
 assert.match(cancel.reply,/Cancel subscription/);assert.match(cancel.reply,/account deletion/i);assert.equal(cancel.status,'open');
 const noCancel=await replyToSupport({kind,messages:[user('Delete my account, but do not cancel my subscription.')]},noModel);
 assert.match(noCancel.reply,/account deletion/i);assert.doesNotMatch(noCancel.reply,/open the workspace account menu/i);
}
console.log('Support account deletion review: passed');
