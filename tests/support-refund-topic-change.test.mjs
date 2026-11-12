import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'Switched on.',source:'fictional'},
 {key:'outreach',status:'ok',source:'fictional',detail:'Saved activity.',outreach:{screened:0,callsStarted:0,textsSent:0,textReplies:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fictional';process.env.OPENAI_API_KEY='fictional';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid models forbidden');};
const history=[{role:'operator',content:'Saved checks show no completed work. The cause remains unconfirmed.'},user('Can I get a refund?'),{role:'assistant',content:'All sales are final; we do not offer refunds.'}];
for(const q of ['I understand your refund policy. My bot has not completed any work. Please investigate the blockage.',
 'I accept the refund policy, but my bot is not doing anything. What is wrong?',
 'I understand your refund policy. My AI has not done any work. Can you check?']){
 const context={kind:'account',messages:[...history,user(q)],evidence,handedOff:true};
 const r=await replyToSupport(context,forbidden);assert.match(r.reply,/no completed work/);assert.match(r.reply,/management review/);assert.doesNotMatch(r.reply,/All sales are final|tell me what happened/);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(supportConversationFallback(context).reply,r.reply);
}
for(const kind of ['account','access']){
 for(const q of ['I understand your refund policy. I still want a refund.','I understand your refund policy, but refund my payment.','I do not accept your refund policy. Refund me.']){
  const r=await replyToSupport({kind,messages:[user(q)],evidence,allowAI:false},forbidden);assert.match(r.reply,/All sales are final|refund policy/);assert.doesNotMatch(r.reply,/refunded|approved a refund/);
 }
 const cancel=await replyToSupport({kind,messages:[...history,user('I understand your refund policy. Cancel my subscription.')],evidence,allowAI:false},forbidden);assert.match(cancel.reply,/Cancel subscription/);
 const course=await replyToSupport({kind,messages:[...history,user('I understand your refund policy. Where is the course?')],evidence,allowAI:false},forbidden);assert.match(course.reply,/course/i);assert.doesNotMatch(course.reply,/no completed work|All sales are final/);
}
const changed=await replyToSupport({kind:'account',messages:[...history,{role:'operator',content:'The remaining question is access.'},user('Where is the course?')],evidence,allowAI:false},forbidden);assert.doesNotMatch(changed.reply,/no completed work|All sales are final/);
assert.equal(calls,0);
console.log('PASS refund acknowledgment versus current technical request; refund/cancellation/operator/topic boundaries; offline only');
