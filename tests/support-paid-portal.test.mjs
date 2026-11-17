import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content});
const opening='I do not know how to get into the portal. I paid $75 for the session but no access information arrived.';
for(const kind of ['access','account']){
 for(const follow of ['', 'I payed but nothing happened after my payment.', 'How do I get started? No information arrived since I paid.', 'How do I get started since I paid the money?' ]){
  const messages=[u(opening),...(follow?[{role:'assistant',content:'Earlier unrelated credit guidance.'},u(follow)]:[])];
  const r=await replyToSupport({kind,allowAI:false,messages});assert.match(r.reply,/purchase.*unconfirmed/i);assert.doesNotMatch(r.reply,/prepaid work credits|Watch the Course|bot show/i);assert.equal(r.status,'open');
 }
 for(const q of ['How do work credits work?','How do I cancel my subscription?','Where are the contracts?','I signed in successfully. How do I change my voice?','I did not pay. What does the portal cost?', 'If I paid, how would I access the portal?', 'I paid and received the access information. Where are the contracts?']){
  const r=await replyToSupport({kind,allowAI:false,messages:[u(opening),u(q)]});assert.doesNotMatch(r.reply,/purchase and access remain unconfirmed/i);
 }
 const guarded=await replyToSupport({kind,allowAI:true,messages:[u(opening)]},async()=>{throw Error('Paid portal routing must not call a model');});assert.match(guarded.reply,/purchase.*unconfirmed/i);
 const r=await replyToSupport({kind,allowAI:false,messages:[u(opening),{role:'operator',content:'The purchase review has new findings; use the existing verified recovery workflow.'},u('How do I get started?')]});assert.doesNotMatch(r.reply,/purchase and access remain unconfirmed/i);
}
console.log('PASS fictional paid-portal priority, continuation, negative/operator/topic boundaries');

const observedAt='2026-09-12T12:00:00Z';
const evidence=[{key:'subscription',source:'icash_memberships',status:'attention',softwareAccess:false,observedAt,detail:'Access inactive.'},{key:'membership_payments',source:'icash_membership_invoices',status:'ok',code:'software_payments_recorded',observedAt,detail:'Recorded software payments: $75.00 recorded 9/12/2026, 11:00:00 AM UTC (subscription active).'}];
const verified=await replyToSupport({kind:'account',allowAI:false,evidence,messages:[u('I just paid but cannot access the portal.')]});
assert.match(verified.reply,/software payment is recorded/i);assert.doesNotMatch(verified.reply,/purchase and access remain unconfirmed/i);
