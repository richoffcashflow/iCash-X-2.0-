import assert from 'node:assert/strict';
import {hasUnresolvedLegacyBilling as check} from '../lib/support-legacy-billing-context.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const initial=u('I would like to know if I could stop the 1.0 billing. It is still attempting to charge me after I moved to 2.0.');
const correction=o('The previous response said old 1.0 charges no longer apply. That claim was unverified. This remains an unresolved legacy billing review, separate from current access. The original payment needs verification.');
const details=u('There was a charge attempt today on 08/06 for $23.61 that was declined.');
const linked=u('This payment is linked to my 1.0 account, not the current platform.');
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
console.log('PASS independent reviewer: fictional operator correction, charge/recharge negatives, polite and mixed factual complaints, four account/guest handoff replays; offline only.');
