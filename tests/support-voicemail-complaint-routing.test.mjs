// Fictional complaints only. The supplied checks contain no call recordings.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'Run is enabled.',source:'fixture',observedAt:'2026-11-08T12:00:00Z'}];
const saved={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let modelCalls=0;
const noModel=async()=>{modelCalls++;throw Error('External model forbidden');};
const ask=(q,history=[],kind='account')=>replyToSupport({kind,messages:[...history,user(q)],evidence},noModel);
try{
 const complaint='On two recorded calls, the bot speaks over the voicemail greeting. My dashboard counts the automated recording as a seller reply. Please explain the available fix and whether it should wait for the beep.';
 for(const kind of ['account','access']){
  const r=await ask(complaint,[],kind);
  assert.match(r.reply,/not a seller response/);
  assert.match(r.reply,/without leaving a message/);
  assert.match(r.reply,/not wait for the beep/);
  assert.match(r.reply,/haven’t verified.*recording|recordings.*need.*review/i);
  assert.doesNotMatch(r.reply,/Call button is for you|missing or slow activity|I (?:fixed|reviewed|listened)|has been corrected/i);
  assert.equal(r.status,'open');
 }
 for(const q of ['My bot talks over the answering-machine greeting. What fix is available?', 'The automated voicemail recording gets counted as a seller response. Are calls enabled correctly?', 'Why is the bot waiting for the voicemail beep?', 'Voicemails are counted as seller responses. What fix is available for these calls?']){
  const r=await ask(q);assert.match(r.reply,/voicemail/);assert.match(r.reply,/review|verified/);assert.equal(r.status,'open');
 }
 const history=[user(complaint),assistant('The timing and dashboard count need review.')];
 for(const q of ['Where is the course?','How do I cancel my subscription?','Are automatic calls enabled? I have zero calls.']){
  const r=await ask(q,history);assert.doesNotMatch(r.reply,/voicemail|beep|greeting/);
 }
 const corrected=await ask('Where is the course?',[...history,operator('The earlier voicemail finding has been reviewed; no change to this customer’s controls.')]);
 assert.doesNotMatch(corrected.reply,/voicemail|beep/);
 const manual=await ask('When I click Call, does the AI speak or can the seller hear me?');assert.doesNotMatch(manual.reply,/voicemail|beep|counts it as a response/);
 const routine=await ask('The seller mentioned voicemail during a live call. What happens after they sign the contract?');assert.doesNotMatch(routine.reply,/counts it as a response|not wait for the beep/);
 assert.equal(modelCalls,0);
}finally{process.env=saved;}
console.log('PASS fictional voicemail complaint priority, timing policy and topic boundaries; no model calls.');
