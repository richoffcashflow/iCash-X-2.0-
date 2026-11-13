import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportVoiceEvidence} from '../lib/support-voice-evidence.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const at='2026-11-01T12:00:00Z';
const check=(key,value)=>({key,source:'fictional',observedAt:at,...value});
const voice=check('voice',supportVoiceEvidence([{state:'held',outcome:'business_number_mismatch',updated_at:at}],0));
const evidence=[voice,check('work',{status:'ok',code:'not_paused',detail:'Not paused.'}),check('outreach',supportOutreachEvidence({screened:8,contactProperties:4,outboundProperties:8,inboundProperties:0,textsSent:6,textsDelivered:2,textReplies:0,callsStarted:5,callsBudgetHeld:0,progress:{status:'ready',spendingMode:'available_balance',remainingCents:700,pendingCents:200,spentCents:0,health:{status:'blocked',reason:'no_completed_work'}}}))];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional';process.env.ICASH_SUPPORT_AI_MODEL='fictional';
let providerCalls=0;
const forbidden=async()=>{providerCalls++;throw Error('No paid model calls');};
const reply=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,...extra},forbidden);
const problem=user('My bot says running but has been stuck since this morning.');
const initial=await reply([problem]);
assert.equal(initial.status,'open');assert.equal(initial.managementReview,true);
assert.match(initial.reply,/past call|saved call/i);assert.match(initial.reply,/can.t confirm whether.*still/i);
assert.match(initial.reply,/service.*review|management review/i);
assert.doesNotMatch(initial.reply,/recorded call attempts|6 texts|so far|Changing your personal number|restarted|actively working/i);
const historical=assistant('The latest saved call was held because the calling service number did not match the saved business number.');
for(const question of ['I did not change any number, so what happens next?','What do I do now?',"What's the next step?",'??','What does that mean?','Will it start calling again or do I need to change anything?']){
 const r=await reply([problem,historical,user(question)],{handedOff:true});
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.match(r.reply,/phone settings|service.*review/i);assert.doesNotMatch(r.reply,/3–5 days|Return to bot|5 recorded|6 texts|Changing your personal number/i);
}
for(const question of ['How do I change my personal phone number?','Where is the course?','I want to cancel my subscription','How many calls were recorded today?','Why are texts not delivering?']){
 const r=await reply([problem,historical,user(question)]);
 assert.doesNotMatch(r.reply,/past call was blocked|current delay|needs a service review/i);
}
const operator=await reply([problem,{role:'operator',content:'The calling-number check is clear now. We are investigating a separate document error.'},user('What do I do now?')],{allowAI:false});
assert.doesNotMatch(operator.reply,/past call was blocked|calling-number setup/i);
const topic=await reply([problem,historical,user('Where is the course?'),assistant('Open Training course.'),user('What do I do now?')],{allowAI:false});
assert.doesNotMatch(topic.reply,/past call was blocked|calling-number setup/i);
const success=await reply([problem,historical,user('It is working now, all fixed!')]);assert.equal(success.status,'resolved');
const unknown=await reply([problem],{evidence:evidence.filter(e=>e.key!=='voice')});assert.doesNotMatch(unknown.reply,/calling-number setup/i);
const paused=await reply([problem],{evidence:evidence.map(e=>e.key==='work'?{...e,code:'paused',status:'attention'}:e)});assert.match(paused.reply,/paused/i);assert.doesNotMatch(paused.reply,/needs a service review/i);
const guest=await reply([problem],{kind:'access',evidence:[],allowAI:false});assert.doesNotMatch(guest.reply,/past call was blocked|calling-number setup/i);
assert.equal(providerCalls,0);
const notificationQuestion=assistant('Which notification or update were you expecting, and when?');
const suppliedUpdate=await reply([notificationQuestion,user('The email alert at noon. Calls are blocked and email alerts are not arriving.')]);
assert.doesNotMatch(suppliedUpdate.reply,/which notification or update.*expecting/i);
assert.equal(suppliedUpdate.status,'open');
console.log('PASS saved call holds: historical scope, useful next step, customer correction, no unrelated totals, topic/operator/success/unknown/paused boundaries');

// A service-number explanation must not swallow a second, current concern.
for(const question of [
 'No calls are starting. My phone and email updates are not working either.',
 'Calls are blocked and updates to my email are missing.',
]){
 const r=await reply([problem,historical,user(question)],{handedOff:true});
 assert.match(r.reply,/past call was blocked/i);
 assert.match(r.reply,/missing notifications.*contact details.*save/i);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);
}
for(const question of [
 'Calls are blocked. Notifications to my phone are not arriving.',
 'No calls are starting and my email alerts are not working.',
]){
 const r=await reply([user(question)]);
 assert.match(r.reply,/which notification or update.*expecting/i);
 assert.equal(r.status,'open');
}
for(const question of [
 'Calls are blocked but my email updates are working now.',
 'Calls are blocked. I am not missing email notifications.',
 'Calls are not working. My phone notifications are fine.',
 'Calls are not working but my email updates arrive.',
 'Calls are blocked. Can I update my phone?',
 'Where is the course?',
]){
 const r=await reply([user('My email updates are not working.'),historical,user(question)],{allowAI:false});
 assert.doesNotMatch(r.reply,/missing notifications.*contact details.*save|which notification or update.*expecting/i);
}
assert.equal(providerCalls,0);
