// Anonymized inbox replays; local fixtures only, with no customer or provider writes.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {currentSupportIssue,supportAcceptedBotCheck,supportReplyEvidence} from '../lib/support-reply-style.ts';
import {supportOutreachEvidence,supportOutreachReply} from '../lib/support-outreach.ts';
import {supportInstructionCorrection} from '../lib/support-reply-guardrails.ts';
import {supportMissingSellerContactQuestion} from '../lib/support-lead-policy.ts';

const user=content=>({role:'user',content});
const assistant=content=>({role:'assistant',content});
const check=(key,fields)=>({key,source:'offline-fixture',observedAt:'2026-11-03T00:00:00Z',...fields});
const evidence=[
 check('work',{status:'ok',code:'not_paused',detail:'Your bot is not paused.'}),
 check('outreach',supportOutreachEvidence({screened:10,outboundProperties:10,inboundProperties:0,contactProperties:8,textsSent:3,textsDelivered:2,textReplies:0,callsStarted:1,callsBudgetHeld:0,progress:null})),
 check('credits',{status:'ok',code:'credit_available',detail:'Unrelated credit information.'}),
];
const prior=[user('What does the bot do next?'),assistant('Let me know if you want me to check your bot status.')];
const environment={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let modelCalls=0;
const noModel=async()=>{modelCalls++;throw Error('Known follow-up must use local recorded evidence');};
try{
 for(const followup of ['Can you check it please','Could you please check that for me?','Yes please','Please do','Go ahead','Sure','OK']){
  const messages=[...prior,user(followup)];
  assert.equal(supportAcceptedBotCheck(messages),true,followup);
  assert.equal(currentSupportIssue(messages),'Check my bot status.');
  assert.deepEqual(supportReplyEvidence(messages,evidence).map(e=>e.key),['work','outreach']);
  const answer=await replyToSupport({kind:'account',messages,evidence},noModel);
  assert.equal(answer.ai,false);assert.equal(answer.status,'open');
  assert.match(answer.reply,/bot is switched on/);assert.match(answer.reply,/1 recorded call attempt and 3 texts \(2 delivered\)/);
  assert.match(answer.reply,/manual activity/);
  assert.doesNotMatch(answer.reply,/What are you trying|what.*status.*\?|credits|healthy|working (?:fine|normally)|I[’']m checking/i);
 }
 // The same offer is meaningful for an operator turn, and OK is an acceptance
 // only when that immediately preceding turn offered this specific check.
 const accepted=[user('How is my bot doing?'),{role:'operator',content:'I can check your bot activity.'},user('OK')];
 assert.equal(supportAcceptedBotCheck(accepted),true);
 assert.match((await replyToSupport({kind:'account',messages:accepted,evidence},noModel)).reply,/recorded call attempt/);
 const plainThanks=supportConversationFallback({kind:'account',messages:[user('What does the bot do?'),assistant('It handles eligible seller outreach automatically.'),user('OK')],evidence});
 assert.equal(plainThanks.reply,'Understood.');

 const noReceipts=await replyToSupport({kind:'account',messages:[...prior,user('Can you check it please?')],evidence:[evidence[0]]},noModel);
 assert.match(noReceipts.reply,/switched on/);assert.match(noReceipts.reply,/can’t verify recent calls or texts/);
 assert.doesNotMatch(noReceipts.reply,/recorded call|everything|working normally/);
 const paused=supportConversationFallback({kind:'account',messages:[...prior,user('Please do')],evidence:[check('work',{status:'attention',code:'paused',detail:'Your bot is paused.'})]});
 assert.match(paused.reply,/bot is paused/);assert.doesNotMatch(paused.reply,/resumed|unpaused|switched on/);
 const unknown=supportConversationFallback({kind:'account',messages:[user('Can you check my bot status?')],evidence:[]});
 assert.match(unknown.reply,/can’t confirm.*Run\/Pause/);assert.equal(unknown.status,'open');

 // Short requests inherit the newest actual problem. Old outreach complaints
 // must not swallow a photo/card/unfamiliar-screen follow-up.
 for(const issue of ['The photos are blank.','The export button is grey.','My credit card won’t save.']){
  const messages=[user('My bot is not calling'),assistant('No calls are recorded yet.'),user(issue),assistant('I can’t confirm the cause yet.'),user('Can you check it please')];
  assert.equal(supportAcceptedBotCheck(messages),false);
  assert.equal(currentSupportIssue(messages),issue);
  assert.equal(supportOutreachReply(messages,evidence),null);
  assert.doesNotMatch(supportConversationFallback({kind:'account',messages,evidence}).reply,/recorded call|automatic outreach|owner details/);
 }
 for(const next of ['My new credit card won’t save.','Cancel my subscription.','The photos are blank.']){
  const messages=[...prior,user(next)];
  assert.equal(supportAcceptedBotCheck(messages),false);
  assert.equal(currentSupportIssue(messages),next);
  assert.doesNotMatch(supportConversationFallback({kind:'account',messages,evidence}).reply,/recorded call|switched on/);
 }
 const continued=[user('My bot is not calling'),assistant('I haven’t confirmed why.'),user('Can you check it please')];
 assert.equal(currentSupportIssue(continued),'My bot is not calling');
 assert.match((await replyToSupport({kind:'account',messages:continued,evidence},noModel)).reply,/recorded call attempt/);

 const wrong=[user('Does the bot handle outreach?'),assistant('The AI bot does not make calls or handle negotiations.'),user('Why does it not call the seller?')];
 const corrected=await replyToSupport({kind:'account',messages:wrong,evidence},noModel);
 assert.match(corrected.reply,/earlier reply was wrong/);assert.match(corrected.reply,/can call eligible sellers automatically/);
 assert.doesNotMatch(corrected.reply,/has called|call happened on your account[.!]/);
 assert.equal(corrected.status,'open');
 assert.equal(supportInstructionCorrection([user('Can it call buyers?'),assistant('The bot does not call buyers.'),user('Can you check it please')],evidence),null);
 for(const accurate of ['The bot cannot call because no usable number is saved.','The bot does not call title companies.','The bot cannot call while paused.','The bot never calls opted out sellers.'])assert.equal(supportInstructionCorrection([user('My bot is not calling'),assistant(accurate),user('Can you check it please')],evidence),null,accurate);
 assert.equal(supportInstructionCorrection([...wrong.slice(0,-1),user('Cancel my subscription')],evidence),null);
 // A negative about an agreement/refresh button must not jump forward to an
 // unrelated number/contact noun and manufacture missing seller information.
 const voicemail='No agreement its just 5 numbers it called and went to voice mail';
 const expired='My seller follow-ups are blocked because my saved contact checks expired. There is no refresh button available. How can I renew or rerun the contact checks so I can continue following up with property owners? Do I need to purchase additional credits?';
 for(const text of [voicemail,expired,'No agreement, but the five numbers are listed.','There are no contact checks to refresh.','No phone calls were made.','The numbers are listed; the agreement is missing.'])assert.equal(supportMissingSellerContactQuestion(text),false,text);
 for(const text of ['none of these leads have contact information','None of these leads have a listed number','No numbers are listed on any of them','When I click text it says no number','The contact number is not saved to the property','The seller phone number is missing','The numbers aren’t showing','I have a lead without a usable seller phone number'])assert.equal(supportMissingSellerContactQuestion(text),true,text);
 const voicemailReply=await replyToSupport({kind:'account',messages:[user(voicemail)],evidence},noModel);
 assert.match(voicemailReply.reply,/not a seller response/);assert.match(voicemailReply.reply,/without leaving a message/);
 assert.doesNotMatch(voicemailReply.reply,/why they’re missing|usable seller number|prepare an agreement/);assert.equal(voicemailReply.status,'open');
 const alertReply=await replyToSupport({kind:'account',messages:[user('I have leads but my AI said it need me')],evidence},noModel);
 assert.match(alertReply.reply,/Needs you/);assert.doesNotMatch(alertReply.reply,/upload|no listings/);assert.equal(alertReply.status,'open');
 const expiredReply=await replyToSupport({kind:'account',messages:[user(expired)],evidence},noModel);
 assert.match(expiredReply.reply,/contact checks expired/);assert.doesNotMatch(expiredReply.reply,/why they’re missing|usable seller number|Add money/);
 const waitReply=await replyToSupport({kind:'account',messages:[user(expired),assistant(expiredReply.reply),user('Do I leave it alone')],evidence},noModel);
 assert.equal(waitReply.reply,expiredReply.reply);assert.equal(waitReply.status,'open');
 const delayed=[user('My bot says Work delayed'),assistant('I haven’t confirmed why work is delayed.'),user('Will it fix itself')];
 assert.equal(currentSupportIssue(delayed),'My bot says Work delayed');
 const delayReply=await replyToSupport({kind:'account',messages:delayed,evidence},noModel);
 assert.match(delayReply.reply,/recorded call attempt/);assert.doesNotMatch(delayReply.reply,/fix itself|What are you trying|will resume|start soon/);assert.equal(delayReply.status,'open');
 const restarted=await replyToSupport({kind:'account',messages:[user('How do I get calls restarted')],evidence},noModel);
 assert.match(restarted.reply,/recorded call attempt/);assert.doesNotMatch(restarted.reply,/Start outreach|will resume|I restarted/);
 const notice=user('Why does the receipt say automated work is delayed and a restart time is still unconfirmed? How do I fix this?');
 const accountCheck=(status,health,extra=[])=>[
  evidence[0],check('outreach',supportOutreachEvidence({...evidence[1].outreach,progress:{status,health,spentCents:80,remainingCents:850}})),...extra,
 ];
 const askDelay=(checks,messages=[notice])=>replyToSupport({kind:'account',messages,evidence:checks},noModel);
 const flagged={status:'blocked',reason:'no_completed_work'};
 const capacityWait=check('research_capacity',{status:'attention',code:'research_capacity_wait',detail:'Research capacity is currently unavailable.'});
 const waiting=await askDelay(accountCheck('ready',flagged,[capacityWait]));
 assert.match(waiting.reply,/property research is waiting for capacity/);assert.match(waiting.reply,/Waiting uses no work credits/i);
 assert.doesNotMatch(waiting.reply,/restart|add (?:money|credits)|What are you trying|management review/i);
 assert.equal(waiting.status,'open');assert.equal(waiting.ai,false);
 const recovered=await askDelay(accountCheck('ready',{status:'ok'}),[notice,assistant(waiting.reply),user('Will it fix itself?')]);
 assert.match(recovered.reply,/latest account work check is clear/);assert.match(recovered.reply,/1 recorded call attempt/);assert.equal(recovered.status,'open');
 const unchecked=await askDelay(accountCheck('ready',flagged));
 assert.equal(unchecked.managementReview,true);assert.match(unchecked.reply,/flagged.*management review/);assert.doesNotMatch(unchecked.reply,/waiting for capacity/);
 const alreadyReviewed=await replyToSupport({kind:'account',messages:[notice],evidence:accountCheck('ready',flagged),handedOff:true},noModel);
 assert.match(alreadyReviewed.reply,/still in management review/);assert.doesNotMatch(alreadyReviewed.reply,/I’ve flagged/);
 assert.equal((await askDelay([])).managementReview,true);
 for(const [status,health,expected] of [['paused',flagged,/Select Run bot/],['membership_required',flagged,/Restore your software access/],['settling',flagged,/on hold/],['budget_reached',flagged,/available work credits are below/i],['ready',{status:'blocked',reason:'system_paused'},/service issue paused/]]){
  const answer=await askDelay(accountCheck(status,health,[capacityWait]));
  assert.match(answer.reply,expected);assert.doesNotMatch(answer.reply,/latest account work check is clear|waiting for capacity/i);
 }
 assert.equal(modelCalls,0,'these replays must not invoke paid AI');
}finally{process.env=environment;}
console.log('PASS support follow-up audit: accepted status checks, actual activity, unknown evidence, topic changes and correction of false seller-call guidance.');
