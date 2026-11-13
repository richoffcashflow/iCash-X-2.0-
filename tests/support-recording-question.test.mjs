import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportCallRecordingReply} from '../lib/support-call-recordings.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let modelCalls=0;
const evidence=[{key:'outreach',status:'ok',source:'fixture',observedAt:'2026-11-01T12:00:00Z',outreach:{screened:18,contactProperties:12,callsStarted:7,textsSent:9,textsDelivered:4,textReplies:0,callsBudgetHeld:0,progress:{status:'ready',remainingCents:1800,spentCents:200}}}];
const ask=(kind,messages,extra={})=>replyToSupport({kind,messages,evidence,...extra},async()=>{modelCalls++;throw Error('No paid model');});
for(const kind of ['account','access']){
 for(const q of ['One seller call has no audio recording.','There is no recording for the seller call.','The recording will not play for a seller call.','I cannot hear the audio on an incoming call recording.']){
  const r=await ask(kind,[user(q)]);
  assert.match(r.reply,/recording/i,q);assert.match(r.reply,/property.*call|call.*property/i,q);assert.equal(r.status,'open');
  assert.doesNotMatch(r.reply,/recorded call attempts|texts \(|why new outreach|not paused|no eligible/i);
  assert.doesNotMatch(r.reply,/I (?:have |’ve )?(?:listened|repaired|fixed)|all calls.*recorded/i);
  const next=await ask(kind,[user(q),assistant(r.reply),user('Can the system record call audio?')]);
  assert.match(next.reply,/supports call recording/i);assert.equal(next.status,'open');assert.doesNotMatch(next.reply,/all calls|every call|\bresolved\b/i);
  const thanks=await ask(kind,[user(q),assistant(r.reply),user('Thanks')]);assert.equal(thanks.status,'open');
  const repeated=await ask(kind,[user(q),assistant(r.reply),user('It still will not play.')]);assert.match(repeated.reply,/recording/i);assert.equal(repeated.status,'open');
  const changed=await ask(kind,[user(q),assistant(r.reply),user('Where is the course?')]);assert.doesNotMatch(changed.reply,/recording issue|call audio/i);
 }
 const capability=await ask(kind,[user('Does iCash X record seller calls?')]);assert.match(capability.reply,/supports call recording/i);assert.doesNotMatch(capability.reply,/every call|all calls|7 call/);
 const repeatCapability=await ask(kind,[user('Does iCash X record seller calls?'),assistant(capability.reply),user('Does iCash X record seller calls?')]);assert.notEqual(repeatCapability.managementReview,true);
 const cancel=await ask(kind,[user('My seller call recording is missing. Cancel my subscription.')]);assert.match(cancel.reply,/Cancel subscription/);
 const fixed=await ask(kind,[user('My seller call recording is missing.'),assistant('Which property and call time are affected?'),user('It is working now.')]);assert.equal(fixed.status,'resolved');
 const human=await ask(kind,[user('My seller call recording is missing.'),operator('The recording is unavailable; a repair is not confirmed.'),user('Can the system record call audio?')]);assert.equal(human.status,'open');
}
for(const q of ['Why do I have no recorded call attempts?','I press Call but the seller cannot hear me.','The seller cannot hear me during the call.','The call reached voicemail; why does that count as a response?','My custom voice recording will not play.'])assert.equal(supportCallRecordingReply({kind:'account',messages:[user(q)]}),null,q);
assert.equal(modelCalls,0);
console.log('PASS recording questions, failed playback, follow-ups, privacy and topic boundaries; offline only');

for(const kind of ['account','access']){
 const messages=[user('The seller call recording is missing.'),assistant('Which property and call time are affected?')];
 const r=await ask(kind,[...messages,user('Is the system able to record audio?')]);
 assert.match(r.reply,/supports call recording/i);assert.match(r.reply,/still unresolved/i);assert.equal(r.status,'open');
 for(const boundary of [operator('Your subscription review remains open.'),user('Where is the course?'),user('It worked.')]){
  assert.equal(supportCallRecordingReply({kind,messages:[...messages,boundary,user('Is the system able to record audio?')]}),null);
 }
 assert.equal(supportCallRecordingReply({kind,messages:[user('Is the system able to record audio?')]}),null);
}

for(const q of ['The calls have no audio.','I press Call but the bot has no audio.'])assert.equal(supportCallRecordingReply({kind:'account',messages:[user(q)]}),null,q);
