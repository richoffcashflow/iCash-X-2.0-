import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportPaymentAccessConcern} from '../lib/support-learning-signals.ts';
import {supportImprovementReport} from '../lib/support-improvement.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const complaint='I paid extra for VIP but nothing is showing.';
const history=[user(complaint),assistant('VIP is not active. The purchase receipt needs to be verified; do not buy it again.')];
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid model calls forbidden');};
try{
 for(const kind of ['account','access']){
  for(const q of ['OK','Thanks','Got it','Understood']){
   const r=await replyToSupport({kind,messages:[...history,user(q)],evidence:[]},forbidden);
   assert.equal(r.status,'open',`${kind}: ${q} is not paid-access recovery`);
   assert.doesNotMatch(r.reply,/restored|activated|fixed|resolved/i);
  }
  const confirmed=await replyToSupport({kind,messages:[...history,user('It worked. VIP is working now.')],evidence:[]},forbidden);
  assert.equal(confirmed.status,'resolved');
  const changed=await replyToSupport({kind,messages:[...history,user('Where is the course?')],evidence:[]},forbidden);
  assert.doesNotMatch(changed.reply,/VIP purchase|receipt|buy.*again/i);
  const operator=await replyToSupport({kind,messages:[...history,{role:'operator',content:'The receipt is for Standard access. The VIP purchase remains unverified.'},user('OK')],evidence:[]},forbidden);
  assert.equal(operator.status,'open');assert.doesNotMatch(operator.reply,/VIP is active|receipt.*needed|email.*receipt/i);
  const routine=await replyToSupport({kind,messages:[user('What does VIP include?'),assistant('VIP includes custom voice.'),user('OK')],evidence:[]},forbidden);
  assert.equal(routine.status,'resolved');
 }
 assert.equal(calls,0);
 for(const q of [complaint,'I bought VIP and it is not active.','I purchased VIP but it is not showing.','I was charged for VIP but it is locked.'])assert.equal(supportPaymentAccessConcern(q),true,q);
 for(const q of ['What if I paid for VIP and nothing is showing?','I did not buy VIP. Nothing is showing.','I never paid for VIP and it is not active.','My seller paid for repairs but nothing is showing.','I paid for VIP and it is working now.','How much does VIP cost?'])assert.equal(supportPaymentAccessConcern(q),false,q);
 const now=new Date('2026-11-01T12:00:00Z');
 const c={id:'fictional-paid-vip',kind:'account',subject:'Fictional access case',status:'resolved',updated_at:now.toISOString(),messages:[...history,user('OK'),assistant('Got it.')].map((m,i)=>({...m,created_at:new Date(now.getTime()-(4-i)*60000).toISOString()}))};
 const report=supportImprovementReport([c],[],now);
 assert.equal(report.metrics.customerConfirmed,0);assert.equal(report.metrics.paymentAccess,1);
 assert.ok(report.candidates[0].codes.includes('unverified_closure'));assert.equal(report.candidates[0].priority,'urgent');
 assert.equal(c.status,'resolved','Review signals do not mutate workflow status');
 const boundary={...c,messages:[...c.messages,{role:'operator',content:'Receipt review is underway.',created_at:now.toISOString()}]};
 assert.equal(supportImprovementReport([boundary],[],now).metrics.paymentAccess,0,'Preserve the existing operator review boundary');
}finally{process.env=env;}
console.log('PASS paid VIP acknowledgment: no false recovery, urgent review, negative/topic/operator boundaries; no model calls.');
