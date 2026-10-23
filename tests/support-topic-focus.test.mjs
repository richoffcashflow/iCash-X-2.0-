// Offline replies only. No customer messages, account changes or paid model calls.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {currentSupportIssue,supportReplyEvidence} from '../lib/support-reply-style.ts';
const user=content=>({role:'user',content});
const check=(key,code,status='attention')=>({key,code,status,source:'fixture',observedAt:'2026-10-23T18:00:00Z',detail:`Fixture ${key} details.`});
const evidence=[check('credits','no_available_credit'),check('readiness','readiness_blocked'),check('work','paused'),check('payments','payment_uncredited')];
const unrelated=/credits?|balance|add money|readiness|service checks|launch checks/i;
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
const model=(reply,answered=false)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,answered})}}]});
try{
 for(const question of ['The photos are blank.','My document download fails.','Please explain the notification bell.','Where can I change my display name?','No, the settings panel freezes.','The new credit card won’t save.']){
  for(const prior of [[],[user('Why are my credits missing?'),{role:'assistant',content:'Your readiness needs attention and your credits are missing.'}]]){
   const context={kind:'account',messages:[...prior,user(question)],evidence};
   assert.equal(currentSupportIssue(context.messages),question,'A new subject replaces the old billing topic');
   assert.deepEqual(supportReplyEvidence(context.messages,evidence),[]);
   assert.doesNotMatch(supportConversationFallback(context).reply,unrelated);
   const focused=await replyToSupport(context,async(_url,init)=>{
    const input=JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.deepEqual(input.verifiedChecks,[]);assert.doesNotMatch(input.suggestedGuidance,unrelated);
    return model('Which page are you seeing this on?');
   });
   assert.equal(focused.ai,true);
   for(const irrelevant of ['You have no work credits.','Add money to continue.','Your service checks passed.','Your bot is ready.','Your readiness needs attention.']){
    const rejected=await replyToSupport(context,async()=>model(irrelevant));
    assert.equal(rejected.ai,false,irrelevant);assert.doesNotMatch(rejected.reply,unrelated);
    assert.notEqual(rejected.status,'resolved','An unrelated passing check never resolves a complaint');
   }
   const outage=await replyToSupport(context,async()=>{throw Error('offline');});
   assert.doesNotMatch(outage.reply,unrelated);
  }
 }
 const newIssue=[user('Why are my credits missing?'),user('The export button is grey.'),user('Still the same.')];
 assert.equal(currentSupportIssue(newIssue),'The export button is grey.','Follow-ups must retain the newest unfamiliar issue, not older billing');
 assert.deepEqual(supportReplyEvidence(newIssue,evidence),[]);
 for(const question of ['The photos are blank.','My document download fails.']){
  const answer=await replyToSupport({kind:'account',messages:[user(question)],evidence},async()=>model('I haven’t confirmed a fix yet.',true));
  assert.equal(answer.ai,true);assert.notEqual(answer.status,'resolved','A model cannot close an unresolved blank screen or failed download');
 }
 const paid={kind:'account',messages:[user('I paid but the payment is missing.')],evidence};
 assert.deepEqual(supportReplyEvidence(paid.messages,evidence).map(e=>e.key),['credits','payments']);
 assert.equal((await replyToSupport(paid,async()=>model('Your recorded payment has not been added to your credits yet. Please do not pay again.'))).ai,true);
 assert.equal((await replyToSupport({kind:'account',messages:[user('My credit card won’t save.')],evidence},async()=>model('I can’t confirm whether the new credit card saved. What does the button beside it say?'))).ai,true,'A credit-card question is not a work-credit question');
 const creditContext={kind:'account',messages:[user('Why are my credits missing?'),{role:'assistant',content:'What happened after checkout?'},user('Still the same.')],evidence};
 assert.match(currentSupportIssue(creditContext.messages),/credits/,'A short continuation retains the actual funding issue');
 assert.deepEqual(supportReplyEvidence(creditContext.messages,evidence).map(e=>e.key),['credits','payments']);
 assert.equal((await replyToSupport(creditContext,async()=>model('Your recorded payment has not been added to your credits yet. Please do not pay again.'))).ai,true);
 const failure={kind:'account',messages:[user('My bot stopped working.')],evidence};
 assert.deepEqual(supportReplyEvidence(failure.messages,evidence).map(e=>e.key),['credits','work','payments'],'A verified missing-credit blocker stays relevant to stopped work');
 const followup={kind:'account',messages:[user('The photos are blank.'),{role:'assistant',content:'I haven’t confirmed a fix.'},user('How do I add listings?')],evidence};
 const answer=await replyToSupport(followup,async()=>{throw Error('Known feature answer is local');});
 assert.match(answer.reply,/don’t need to add listings/);assert.doesNotMatch(answer.reply,unrelated);assert.equal(answer.status,'open');
 for(const question of ['How do I upload properties? I’m not sure.','I cannot add a listing.']){
  const answer=supportConversationFallback({kind:'account',messages:[user(question)],evidence});
  assert.match(answer.reply,/don’t need to add listings/);assert.doesNotMatch(answer.reply,unrelated);
 }
 assert.doesNotMatch(supportConversationFallback({kind:'account',messages:[user('My bot is not making calls or texts.')],evidence:[]}).reply,unrelated);
}finally{process.env=env;}
console.log('PASS support topic focus: complaints, new topics, follow-ups, AI drift and outages omit unrelated readiness/credits; genuine funding issues and unresolved cases remain open.');
