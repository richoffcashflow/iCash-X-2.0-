import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportCreditBalanceReply} from '../lib/support-credit-balance.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
const evidence=[{key:'outreach',source:'fictional',observedAt:'2026-11-01T12:00:00Z',...supportOutreachEvidence({screened:12,contactProperties:4,outboundProperties:12,inboundProperties:0,textsSent:6,textsDelivered:2,textReplies:0,callsStarted:3,callsBudgetHeld:2,progress:{status:'ready',spendingMode:'available_balance',remainingCents:1875,pendingCents:0,spentCents:225,health:{status:'blocked',reason:'no_completed_work'}}})},{key:'voice',status:'attention',code:'voice_unclassified_hold',detail:'A saved call has an unexplained hold.'}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional';process.env.ICASH_SUPPORT_AI_MODEL='fictional';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid model forbidden');};
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,...extra},forbidden);
const question='Can you explain unfinished work and reserved costs? I have credits left but cannot tell if my bot is working.';
const r=await ask([user(question)]);
assert.match(r.reply,/reserved cost|committed/i);
assert.match(r.reply,/\$18\.75/);assert.match(r.reply,/\$0\.00/);
assert.match(r.reply,/not.*(?:task list|identify|confirm)|can.t.*(?:itemize|identify)/i);
assert.doesNotMatch(r.reply,/^A saved call|will (?:start|resume)|depend on resolving.*pending/i);
assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.equal(r.ai,false);
const follow=await ask([user(question),assistant('Earlier generic reply.'),user('I want to be sure I am doing my part by funding it.')]);
assert.match(follow.reply,/\$0\.00/);assert.doesNotMatch(follow.reply,/will (?:start|resume)|depend on resolving.*pending/i);
for(const q of [question,'What does pending work mean?','Which tasks are behind my reserved work credits?']){
 for(const extra of [{kind:'access'},{evidence:[]},{handedOff:true}]){
  const answer=await ask([operator('No recovery is confirmed.'),user(q)],extra);
  assert.match(answer.reply,/reserved cost|committed/i);assert.equal(answer.status,'open');assert.equal(answer.ai,false);
  if(extra.kind==='access'||extra.evidence)assert.doesNotMatch(answer.reply,/\$18\.75|\$0\.00/);
 }
}
const paused=await ask([user(question)],{evidence:[...evidence,{key:'work',status:'attention',code:'paused',detail:'Paused'}]});assert.match(paused.reply,/paused/i);
const positive=structuredClone(evidence);positive[0].outreach.progress.pendingCents=325;
assert.match((await ask([user(question)],{evidence:positive})).reply,/\$3\.25/);
const unknown=structuredClone(evidence);unknown[0].status='unknown';
assert.doesNotMatch((await ask([user(question)],{evidence:unknown})).reply,/\$18\.75|\$0\.00/);
const mismatch=[evidence[0],{key:'voice',status:'attention',code:'voice_business_number_mismatch',detail:'Fictional prior call setup mismatch.'}];
assert.match((await ask([user('What does unfinished work mean when my bot is not working?')],{evidence:mismatch})).reply,/reserved cost/i);
for(const q of ['I am not asking about pending work. How do I change my password?','I understand what pending work means. How do I change my password?','What are the reserved costs for the buyer mortgage?','Cancel my subscription and refund pending work','I was charged twice for work credits','What does unfinished work mean in the repair estimate?','My pending work is finished now. How do I open the course?']){
 assert.equal(supportCreditBalanceReply({kind:'account',messages:[user(q)],evidence}),null,q);
}
const short='I want to be sure I am doing my part by funding it.';
for(const messages of [[user(short)],[user(question),operator('The review now concerns a disputed purchase.'),user(short)],[user(question),assistant('Explained.'),user('Where is the course?'),assistant('In the menu.'),user(short)]])assert.equal(supportCreditBalanceReply({kind:'account',messages,evidence}),null);
assert.equal(calls,0);
console.log('PASS pending-work explanations and immediate funding clarification boundaries');
