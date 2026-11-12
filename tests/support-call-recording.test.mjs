import assert from 'node:assert/strict';
import {supportCallRecordingReply} from '../lib/support-call-recording.ts';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const evidence=[{key:'outreach',status:'ok',source:'fictional',detail:'Saved activity.',outreach:{screened:8,callsStarted:3,textsSent:5,textReplies:0}}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fictional';process.env.OPENAI_API_KEY='fictional';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid models forbidden');};
for(const kind of ['account','access']){
 for(const q of ['There is no audio recording from a seller call.','The seller call recording is missing.','I cannot play the call recording.']){
  const c={kind,messages:[user(q)],evidence};const r=await replyToSupport(c,forbidden);
  assert.match(r.reply,/recording/i);assert.match(r.reply,/call time/i);assert.doesNotMatch(r.reply,/3 call|5 text|outreach hasn/);assert.equal(r.status,'open');assert.equal(supportConversationFallback(c).reply,r.reply);
 }
 const c={kind,messages:[user('There is no audio recording from a seller call.'),{role:'assistant',content:'Which call time is affected?'},user('Is the system able to record audio?')],evidence};
 const r=await replyToSupport(c,forbidden);assert.equal(r.status,'open');assert.match(r.reply,/does not confirm/i);
 for(const q of ['Where is the training course?','Cancel my subscription.','How do I upload a recording for my custom voice?']){
  const r=await replyToSupport({...c,messages:[...c.messages,user(q)],allowAI:false},forbidden);assert.doesNotMatch(r.reply,/Which property and call time/);
 }
 const done=await replyToSupport({...c,messages:[...c.messages,user('It worked.')]},forbidden);assert.equal(done.status,'resolved');
}
for(const middle of [{role:'operator',content:'The customer is asking about a training video now.'},user('Where is the course?'),user('It worked.')])assert.equal(supportCallRecordingReply({kind:'account',messages:[user('The seller call recording is missing.'),middle,user('Can the system record audio?')]}),null);
for(const q of ['The calls have no audio.','I press Call but the bot has no audio.'])assert.equal(supportCallRecordingReply({kind:'account',messages:[user(q)]}),null);
assert.equal(calls,0);console.log('PASS missing call recording, capability, guest privacy and topic/success boundaries; offline only');
