import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}),operator=content=>({role:'operator',content});
const evidence=[{key:'outreach',source:'fictional',observedAt:'2026-11-01T12:00:00Z',...supportOutreachEvidence({screened:9,contactProperties:3,outboundProperties:9,inboundProperties:0,textsSent:7,textsDelivered:5,textReplies:0,callsStarted:4,callsBudgetHeld:2,progress:{status:'ready',spendingMode:'available_balance',remainingCents:1850,pendingCents:250,spentCents:0,health:{status:'blocked',reason:'no_completed_work'}}})}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional';process.env.ICASH_SUPPORT_AI_MODEL='fictional';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid models forbidden');};
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,...extra},forbidden);
const sending=await ask([user('Why are my messages not sending?')]);
assert.match(sending.reply,/which property|delivery status|sending record/i);
assert.doesNotMatch(sending.reply,/call jobs|call hold|new calls|calls waiting/i);
const funding=await ask([user('Should I buy more work credits to get my bot moving, or wait for pending tasks to clear?')]);
assert.match(funding.reply,/not.*(?:confirm|guarantee)|haven.t confirmed/i);
assert.doesNotMatch(funding.reply,/will keep moving|will (?:start|restart)|as soon as|enough credits/i);
for(const q of ["Why aren't my messages sending?",'My texts are not sending.','I cannot send messages to a seller.']){
 const r=await ask([user(q)]);assert.match(r.reply,/delivery status|sending record/i);assert.doesNotMatch(r.reply,/call hold|call jobs/i);assert.equal(r.status,'open');
}
for(const q of ['Do I add more credits to keep the bot moving or wait until pending work credits clear?','Will adding money restart my bot?','Should I wait for pending tasks before buying credits?']){
 for(const extra of [{},{kind:'access'},{evidence:[]},{handedOff:true}]){
  const r=await ask([operator('The investigation remains open; no restart was verified.'),user(q)],extra);
  assert.match(r.reply,/not a confirmed repair/i);assert.equal(r.status,'open');assert.equal(r.ai,false);
  if(extra.kind==='access'||extra.evidence)assert.doesNotMatch(r.reply,/\$18\.50|\$2\.50/);
 }
}
for(const q of ['Cancel my subscription','I was charged twice for work credits','How much do credits cost?','What does the buyer need to sign?','My sign-in code messages are not sending','My email messages are not sending']){
 const r=await ask([user('Why are my messages not sending?'),operator('No recovery is confirmed.'),user(q)],{allowAI:false});
 assert.doesNotMatch(r.reply,/Which property is affected|not a confirmed repair/);
}
const paused=await ask([user('Will adding money restart my bot?')],{evidence:[...evidence,{key:'work',status:'attention',code:'paused',detail:'Paused'}]});assert.match(paused.reply,/currently paused/i);
const changed=await ask([user('Should I wait for pending work credits?'),operator('No restart has been verified.'),user('How do I change my password?')],{allowAI:false});assert.doesNotMatch(changed.reply,/\$18\.50|not a confirmed repair/);
assert.equal(calls,0);
console.log('PASS text sending and funding-repair boundaries without model or providers');
