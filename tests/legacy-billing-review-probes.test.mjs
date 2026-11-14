import assert from 'node:assert/strict';
import {hasUnresolvedLegacyBilling as check} from '../lib/support-legacy-billing-context.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const initial=u('Hi, I wanted to know if I could disable my usage activity for the iCash X 1.0 version. I have not manually called or messaged anyone in a month, but the software is still attempting to charge me.');
const correction=o('You’re asking about the old 1.0 billing, and you’ve already explained that 2.0 access works. The earlier claim that 1.0 charges no longer apply was not verified and should not have been stated. Retiring the platform does not by itself prove an old payment attempt or automatic recharge stopped. I’m keeping this as an unresolved billing review. What date, amount and merchant description appear on the attempted charge, and does it say failed, pending or completed? Leave out card numbers and codes. No billing, refund or access change has been made.');
const details=u('There was a charge attempt today on 11/14 for $14.37 that was declined.');
const linked=u('It is not linked to my current iCash X 2.0 account but it is linked to my 1.0 account.');
const turns=[initial,correction,details,linked];
assert.equal(check(turns),true,'quoted false no-longer claim must not reset unresolved review');
for(const text of ['1.0 is still attempting to charge me. I never use it anymore.','1.0 is still attempting to charge me. Will you stop it?'])assert.equal(check([u(text)]),true,text);
for(const text of ['1.0 is no longer attempting to charge me.','1.0 is no longer attempting an automatic recharge.','If 1.0 attempted to charge me, could I get a refund?'])assert.equal(check([u(text)]),false,text);
assert.equal(check([initial,o('The old 1.0 payment is no longer an unresolved billing review.'),linked]),false);
assert.equal(check([initial,o('The old billing charge is still unverified. Keep this open.'),linked]),true);
const saved={...process.env};let calls=0;
try{
 process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
 const noModel=async()=>{calls++;throw Error('No model request allowed');};
 for(const kind of ['account','access'])for(const handedOff of [false,true]){
  const r=await replyToSupport({kind,handedOff,messages:turns},noModel);
  assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);
  assert.match(r.reply,/retirement does not establish/i);
  assert.doesNotMatch(r.reply,/What date|two calendar months|charges.*do not apply|already supplied[^;]*confirmed/i);
  assert.match(r.reply,/do not repeat/);
 }
 assert.equal(calls,0);
}finally{process.env=saved;}
console.log('PASS independent reviewer: exact-shaped correction, charge/recharge negatives, polite and mixed factual complaints, four account/guest handoff replays; offline only.');
