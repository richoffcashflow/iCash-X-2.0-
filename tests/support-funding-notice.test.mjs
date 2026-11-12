import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportAccountReviewReply} from '../lib/support-account-review.ts';
const user=content=>({role:'user',content});
const question='My bot is on but the notice alternates between Credits added, checking your bot’s status and Credits added. Let’s get to work. Is it working?';
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'On',source:'fixture',observedAt:'2026-11-12T00:00:00Z'},{key:'outreach',code:'fixture',status:'attention',source:'fixture',observedAt:'2026-11-12T00:00:00Z',detail:'Saved checks',outreach:{callsStarted:8,textsSent:6,textReplies:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}},{key:'billing',code:'checkout_pending',status:'attention',detail:'Unrelated old checkout',source:'fixture',observedAt:'2026-11-12T00:00:00Z'}];
const original={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let calls=0;
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,...extra},async()=>{calls++;throw Error('Paid model forbidden');});
try{
 for(const q of [question,'The banner says Credits added. Checking your bot\'s status. Should I worry?','Credits added. Let’s get to work. Does that mean the bot started?']){
  const r=await ask([user(q)]);
  assert.match(r.reply,/status refresh/i);assert.match(r.reply,/not.*pending payment/i);
  assert.match(r.reply,/do not prove.*work/i);assert.match(r.reply,/activity.*blocked/i);
  assert.equal(r.status,'open');assert.equal(r.managementReview,true);
  assert.doesNotMatch(r.reply,/return to.*checkout|payment is pending|working normally|will start|buy more/i);
 }
 const unknown=await ask([user(question)],{evidence:[]});assert.match(unknown.reply,/can.t verify current activity/i);assert.doesNotMatch(unknown.reply,/payment.*confirmed|activity.*blocked/i);
 const guest=await ask([user(question)],{kind:'access'});assert.match(guest.reply,/can.t verify.*guest chat/i);assert.doesNotMatch(guest.reply,/8 call|activity.*blocked|your payment is confirmed/i);
 const paused=await ask([user(question)],{evidence:[{...evidence[0],status:'attention',code:'paused'},evidence[1]]});assert.match(paused.reply,/paused/i);assert.doesNotMatch(paused.reply,/no completed work/i);
 const pending=await ask([user(question)],{evidence:[evidence[0],{...evidence[1],outreach:{...evidence[1].outreach,progress:{status:'settling'}}}]});assert.match(pending.reply,/earlier work.*confirmation/i);
 const healthy=await ask([user(question)],{evidence:[evidence[0],{...evidence[1],status:'ok',outreach:{...evidence[1].outreach,progress:{status:'ready',health:{status:'ok'}}}}]});assert.match(healthy.reply,/do not prove.*work/i);assert.equal(healthy.status,'open');assert.doesNotMatch(healthy.reply,/working normally|fixed|activity.*blocked/i);
 for(const q of ['My checkout is pending','Credits added but I was charged twice','Credits added. Let’s get to work. Cancel my subscription.','Credits added. Let’s get to work. I need a refund','Credits added. Let’s get to work. I was charged incorrectly.','Credits added. Let’s get to work. I cannot access my account.','Where is my agreement?']){
  assert.equal(supportAccountReviewReply({kind:'account',messages:[user(question),{role:'assistant',content:'The activity is unverified.'},user(q)],evidence}),null,q);
 }
 assert.equal(calls,0);
}finally{process.env=original;}
console.log('Funding notice guidance: receipt versus activity, account/guest/unknown/Pause/pending evidence and billing/topic boundaries passed. No provider calls.');
