import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportPurchaseComplaintReply} from '../lib/support-purchase-complaint.ts';
const user=content=>({role:'user',content}),agent=content=>({role:'assistant',content});
const receipt={key:'work_value',source:'fixture',status:'ok',code:'work_receipt_checked',observedAt:'2026-01-01T00:00:00Z',detail:'Today, fictional work usage was $3.25; no seller responses are recorded.'};
const noModel=async()=>{throw Error('Paid models forbidden');};
for(const kind of ['account','access']){
 for(const question of ['This software is not what I paid for.','This service isn’t what I bought.','This is not what I paid for!']){
  const r=await replyToSupport({kind,messages:[user('I would like my money back.'),agent('The refund policy is unchanged. What went wrong?'),user(question)],evidence:[receipt]},noModel);
  assert.match(r.reply,/feature or service.*different/i);
  assert.doesNotMatch(r.reply,/fictional work usage|all sales are final|fixed|resolved/i);
  assert.equal(r.status,'waiting_on_customer');
 }
}
for(const kind of ['account','access']){
 const history=[user('This software is not what I paid for.'),agent('Which feature or service was different, and what happened when you tried it?')];
 for(const question of ['What did my money get me today?','This property is not what I paid for.','This is what I paid for.','This is not what I paid for, and I cannot sign in.','This is not what I paid for; cancel my subscription.','This is not what I paid for; I was charged twice.','Where is the course?','It worked.','My lawyer will contact you.']){
  assert.equal(supportPurchaseComplaintReply({kind,messages:[...history,user(question)]}),null,question);
 }
 const operator=await replyToSupport({kind,messages:[...history,{role:'operator',content:'The payment check remains incomplete; review is continuing.'},user('This is not what I paid for.')],evidence:[receipt]},noModel);
 assert.match(operator.reply,/operator’s finding/);assert.equal(operator.status,'open');assert.doesNotMatch(operator.reply,/fictional work usage|Which feature/);
 const repeat=await replyToSupport({kind,messages:[...history,user('This service is not what I bought.')],evidence:[receipt]},noModel);
 assert.equal(repeat.status,'open');assert.doesNotMatch(repeat.reply,/Which feature/);
 const thanks=await replyToSupport({kind,messages:[...history,user('Thank you.')],evidence:[]},noModel);
 assert.notEqual(thanks.status,'resolved');assert.notEqual(thanks.status,'closed');
 const topic=await replyToSupport({kind,messages:[...history,user('Where is the course?')],evidence:[]},noModel);
 assert.match(topic.reply,/PDF download and practice workspace/);assert.equal(topic.status,'open');
 const cancel=await replyToSupport({kind,messages:[...history,user('Cancel my subscription.')],evidence:[]},noModel);
 assert.match(cancel.reply,/Cancel subscription/);
 const duplicate=await replyToSupport({kind,messages:[...history,user('I was charged twice.')],evidence:[]},noModel);
 assert.match(duplicate.reply,/duplicate-charge report/);assert.equal(duplicate.managementReview,true);
}
const value=await replyToSupport({kind:'account',messages:[user('What did my money get me today?')],evidence:[receipt]},noModel);
assert.equal(value.reply,receipt.detail);
const priorEnv={...process.env};
try{
 process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture-only';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
 for(const kind of ['account','access'])assert.equal((await replyToSupport({kind,messages:[user('This app is not what I purchased.')]},noModel)).ai,false);
}finally{process.env=priorEnv;}
console.log('PASS fictional purchase-complaint routing.');
