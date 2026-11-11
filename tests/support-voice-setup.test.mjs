import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportVoiceSetupReply} from '../lib/support-voice-setup.ts';

const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const vip={key:'vip',status:'ok',code:'vip_active',detail:'VIP is active.',source:'offline',observedAt:'2026-11-11T00:00:00Z'};
const context=(kind,messages,evidence=[vip])=>({kind,messages,evidence});
const first=user('My voice recording will not upload to the bot.');
const baseline=supportConversationFallback(context('account',[first]));
assert.match(baseline.reply,/uploading.*creates.*clone/i);
assert.equal(baseline.status,'open');
let calls=0;
const model=async()=>{calls++;throw Error('Paid models forbidden in offline voice setup replays');};
const old={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline';process.env.ICASH_SUPPORT_AI_MODEL='offline';
try{
 for(const kind of ['account','access']){
  for(const q of ['My voice recording will not upload to the bot.','How do I create my custom voice?','I cannot submit my voice for the bot','How can I upload my own voice?']){
   const r=await replyToSupport(context(kind,[user(q)]),model);
   assert.match(r.reply,/uploading.*creates.*clone/i);assert.match(r.reply,/Choose recording/);
   assert.match(r.reply,/Create my voice/);assert.match(r.reply,/under 4 MB/);assert.equal(r.ai,false);assert.equal(r.status,'open');
  }
  const history=[first,assistant('You need a ready cloned voice before uploading.')];
  const correct=await replyToSupport(context(kind,[first,assistant(baseline.reply),user('It says there is an issue')]),model);
  assert.doesNotMatch(correct.reply,/earlier instruction was incorrect/i,'Do not correct already accurate setup guidance');
  const error=await replyToSupport(context(kind,[...history,user('It says there is an issue')]),model);
  assert.match(error.reply,/earlier instruction was incorrect/i);
  assert.match(error.reply,/do not need.*ready/i);assert.match(error.reply,/Refresh/);assert.match(error.reply,/exact message/i);assert.equal(error.status,'open');
  const uncertain=await replyToSupport(context(kind,[...history,user('It is still creating my voice')]),model);
  assert.match(uncertain.reply,/Refresh/);assert.match(uncertain.reply,/do not submit/i);assert.equal(uncertain.status,'open');
  for(const q of ['It still says not ready','It is not ready','It says the clone isn’t ready']){
   const r=await replyToSupport(context(kind,[...history,user(q)]),model);
   assert.match(r.reply,/Refresh/);assert.match(r.reply,/do not submit/i);assert.doesNotMatch(r.reply,/Use my voice/);
  }
  const large=await replyToSupport(context(kind,[...history,user('It says the file is over 4 MB')]),model);
  assert.match(large.reply,/under 4 MB/);assert.doesNotMatch(large.reply,/exact message/i);
  const consent=await replyToSupport(context(kind,[...history,user('It says confirm this is my own voice')]),model);
  assert.match(consent.reply,/box/);assert.doesNotMatch(consent.reply,/exact message/i);
  const verified=await replyToSupport(context(kind,[...history,user('It says additional verification is required')]),model);
  assert.equal(verified.managementReview,true);assert.equal(verified.status,'open');
  const inactive=await replyToSupport(context(kind,[first],[{...vip,code:'vip_inactive'}]),model);
  if(kind==='account'){assert.match(inactive.reply,/VIP is not active/);assert.match(inactive.reply,/do not purchase/i);}
  else assert.doesNotMatch(inactive.reply,/check shows VIP is not active/);
  const unknown=await replyToSupport(context(kind,[first],[{...vip,status:'unknown',code:undefined}]),model);
  assert.doesNotMatch(unknown.reply,/VIP is (?:not )?active/);
  const repeated=await replyToSupport(context(kind,[...history,user('It says there is an issue'),assistant(error.reply),user('Same issue')]),model);
  assert.equal(repeated.managementReview,true);assert.doesNotMatch(repeated.reply,/exact message/i);
  for(const q of ['Cancel my subscription','I was charged twice','How do I listen to my cloned voice?','The seller call recording will not upload','I cannot upload a contract','How do I change my phone number?','My browser call has no sound','Upload my leads','It worked','That worked, thanks']){
   const c=context(kind,[...history,user(q)]);
   assert.equal(supportVoiceSetupReply(c),null,q);
   assert.doesNotMatch(supportConversationFallback({...c,allowAI:false}).reply,/Uploading your recording creates|Choose recording|Create my voice/,q);
  }
  assert.equal(supportVoiceSetupReply(context(kind,[...history,user('Where is the course?'),assistant('Open Course.'),user('Same issue')])),null);
  assert.equal(supportVoiceSetupReply(context(kind,[...history,{role:'operator',content:'The saved upload is under review. Do not resubmit.'},user('Same issue')])),null);
  assert.equal(supportVoiceSetupReply(context(kind,[...history,user('It worked'),user('Same issue')])),null);
  const ready=await replyToSupport(context(kind,[...history,user('It shows ready')]),model);
  assert.match(ready.reply,/If Custom voice shows/);assert.match(ready.reply,/does not confirm/);assert.equal(ready.status,'open');
 }
 assert.equal(calls,0);
}finally{process.env=old;}
console.log('PASS fictional account/guest voice setup, uncertainty, consent and entitlement replays; no paid calls.');
