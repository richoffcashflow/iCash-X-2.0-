import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportCallHoldReply} from '../lib/support-call-hold-guidance.ts';
const u=content=>({role:'user',content});
const evidence=[{key:'voice',status:'attention',code:'voice_business_number_mismatch',detail:'A saved call had a number mismatch.'}];
for(const q of ["If the seller doesn't answer, will the bot call again?",'Will you call the seller again if they do not answer?']){
 const context={kind:'account',messages:[u('My bot is stuck.'),u(q)],evidence,handedOff:true,allowAI:false};
 assert.equal(supportCallHoldReply(context),null,q);
 const r=await replyToSupport(context,async()=>{throw Error('Paid model forbidden');});assert.match(r.reply,/eligible.*additional|additional.*eligible/);assert.match(r.reply,/not.*promise|can.t promise/);assert.doesNotMatch(r.reply,/past call was blocked|calling-number setup/);assert.equal(r.status,'open');
}
const guest=await replyToSupport({kind:'access',messages:[u("If the seller doesn't answer, will it call again?")],allowAI:false});assert.match(guest.reply,/additional automatic attempt/);assert.doesNotMatch(guest.reply,/calling-number setup/);
const current={kind:'account',messages:[u('My bot is not calling sellers.')],evidence};assert.match(supportCallHoldReply(current).reply,/past call was blocked/);
console.log('PASS conditional unanswered seller questions do not diagnose account outage');
