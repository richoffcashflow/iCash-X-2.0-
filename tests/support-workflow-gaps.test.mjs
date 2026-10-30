import assert from 'node:assert/strict';
import {supportConversationFallback,replyToSupport} from '../lib/support-conversation.ts';
import {supportVoiceEvidence} from '../lib/support-voice-evidence.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
import {supportTopic} from '../lib/support-policy.ts';

// Invented account totals and messages; no customer records or identifiers.
const observedAt='2026-10-30T04:00:00Z';
const check=(key,value)=>({key,source:'fixture',observedAt,...value});
const progress={status:'ready',spendingMode:'available_balance',remainingCents:200,pendingCents:800,spentCents:1000};
const outreach=check('outreach',supportOutreachEvidence({screened:12,contactProperties:7,outboundProperties:12,inboundProperties:0,textsSent:9,textsDelivered:9,textReplies:0,callsStarted:0,callsBudgetHeld:0,progress}));
const voice=check('voice',supportVoiceEvidence([{state:'held',outcome:'production_agent_review_required',updated_at:observedAt}],0));
const evidence=[outreach,voice,check('work',{status:'ok',code:'not_paused',detail:'Your bot is not paused.'}),check('credits',{status:'ok',code:'credit_available',detail:'Legacy wallet total is not proof of spendable funds.'})];
const context=(questions,extra=evidence)=>({kind:'account',messages:questions.map(content=>({role:'user',content})),evidence:extra});
for(const question of ['Why do I have 0 recorded call attempts and 9 texts?','Why is it only sending texts?','My bot is not calling']){
 const result=supportConversationFallback(context([question]));
 assert.match(result.reply,/latest saved call.*approved setup/i);assert.doesNotMatch(result.reply,/add more|keep watching|everything.*ready/i);assert.equal(result.status,'open');
}
for(const followup of ['I already have credits','Well can you confirm it','Am I doing something wrong?']){
 const result=supportConversationFallback(context(['My bot is not calling',followup]));
 assert.match(result.reply,/approved setup/);assert.equal(result.status,'open');
}
for(const question of ['Do I have enough credits for calls?','Is that enough?']){
 const result=supportConversationFallback(context(['Do I have enough credits for calls?',question]));
 assert.match(result.reply,/\$2\.00.*new work/);assert.match(result.reply,/\$8\.00.*earlier work/);assert.doesNotMatch(result.reply,/Legacy wallet/);
}
for(const question of ['Where is the Documents tab?','There is no section called documents','How do I create a contract?']){
 const result=supportConversationFallback(context(['My bot is not calling',question]));
 assert.match(result.reply,/Your leads.*Take over.*Seller is ready for an agreement/);assert.doesNotMatch(result.reply,/credits|call attempts|approved setup/);
}
assert.match(supportConversationFallback(context(['Where do I download the assignment contract?'])).reply,/after the purchase agreement is signed/);
for(const questions of [['No reply to delivered question'],['No reply to delivered question','How should I reply?']]){
 const result=supportConversationFallback(context(questions));assert.match(result.reply,/internal note/);assert.match(result.reply,/does not reply.*restart outreach/);assert.equal(result.status,'open');
}
assert.match(supportConversationFallback(context(['Save resolution is disabled'])).reply,/at least 10 characters/);
assert.match(supportConversationFallback(context(['Contact checks expired','So what should I do?'])).reply,/no customer button.*does not renew/);
assert.match(supportConversationFallback(context(['Why is the seller phone number missing?'])).reply,/separate from your own number/);
assert.equal(supportTopic('Where are the owner details?'),'work');
assert.equal(supportTopic('Can I speak to the owner?'),'human');
assert.match(supportConversationFallback(context(['My bot is not calling','I want a human'])).reply,/automated support.*isn’t a live transfer/);
assert.doesNotMatch(supportConversationFallback(context(['Where is the Documents tab?','My credit card is not saving'])).reply,/Agreements|Take over/);

process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;
for(const question of ['Where is the Documents tab?','Contact checks expired','Why do I have 0 recorded call attempts?']){
 const reply=await replyToSupport(context([question]),async()=>{calls++;throw Error('No provider use in replay');});assert.equal(reply.ai,false);
}
assert.equal(calls,0,'known gaps cannot be overwritten by model guesses');
assert.equal(supportVoiceEvidence([{state:'dispatched',outcome:'production_agent_review_required',updated_at:observedAt}],0).code,'voice_clear');
assert.equal(supportVoiceEvidence([{state:'held',outcome:'unknown_new_reason',updated_at:observedAt}],0).code,'voice_clear');
assert.throws(()=>supportVoiceEvidence([{state:'held',outcome:'production_agent_review_required',updated_at:'invalid'}],0));
assert.doesNotMatch(JSON.stringify(supportVoiceEvidence([{state:'held',outcome:'unknown_secret',updated_at:observedAt}],0)),/unknown_secret/);
console.log('PASS support workflow replays: call holds, committed credit, agreements, resolution notes, topic changes and no provider actions');
