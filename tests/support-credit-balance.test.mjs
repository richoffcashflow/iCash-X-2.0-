import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const evidence=[{key:'outreach',source:'fictional',observedAt:'2026-11-01T12:00:00Z',...supportOutreachEvidence({screened:8,contactProperties:2,outboundProperties:8,inboundProperties:0,textsSent:2,textsDelivered:1,textReplies:0,callsStarted:3,callsBudgetHeld:0,progress:{status:'ready',spendingMode:'available_balance',remainingCents:1725,pendingCents:475,spentCents:0}})}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional';process.env.ICASH_SUPPORT_AI_MODEL='fictional';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid models forbidden');};
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,...extra},forbidden);
for(const q of ['How much credits do you see now?','What is my current credit balance?','How much do I have left in work credits?','You said I had $2 available for new work but my screen shows $22. Why is it different?']){
 const r=await ask([user('My bot has stopped working.'),assistant('Your case is in management review.'),user(q)],{handedOff:true});
 assert.equal(r.status,'open');assert.match(r.reply,/\$17\.25/);assert.match(r.reply,/\$4\.75/);assert.match(r.reply,/not final charges|not a final charge/i);assert.doesNotMatch(r.reply,/Open Add money|purchase summary|confirmed.*deposit|bot is working/i);
}
const first=await ask([user('What is my current credit balance?')]);assert.equal(first.ai,false);assert.match(first.reply,/\$17\.25/);
for(const q of ['How much do credits cost?','How much should I add to start?','How much work credits can I buy now?','What credit score do I need now?','What is the seller asking price?','I was charged twice for credits','Cancel my subscription and refund my credits']){
 const r=await ask([user('What is my current credit balance?'),assistant(first.reply),user(q)],{allowAI:false});assert.doesNotMatch(r.reply,/\$17\.25/);
}
const unknown=await ask([user('How much credits do you see now?')],{evidence:[]});assert.match(unknown.reply,/can.t verify/i);assert.doesNotMatch(unknown.reply,/\$|zero credits|Add money/i);
const guest=await ask([user('How much credits do you see now?')],{kind:'access'});assert.doesNotMatch(guest.reply,/\$17\.25|\$4\.75/);assert.match(guest.reply,/sign in|signed.in/i);
const incomplete=await ask([user('How much credits do you see now?')],{evidence:evidence.map(e=>({...e,outreach:{...e.outreach,progress:{...e.outreach.progress,pendingCents:undefined}}}))});assert.match(incomplete.reply,/can.t verify/i);assert.doesNotMatch(incomplete.reply,/\$17\.25/);
const zero=await ask([user('What is my current credit balance?')],{evidence:evidence.map(e=>({...e,outreach:{...e.outreach,progress:{...e.outreach.progress,remainingCents:0,pendingCents:2200}}}))});assert.match(zero.reply,/\$0\.00/);assert.match(zero.reply,/\$22\.00/);
assert.equal(calls,0);
console.log('PASS current work-credit replies: fresh available amount, pending commitments, unknown/zero/guest, payment and topic boundaries; no providers');
