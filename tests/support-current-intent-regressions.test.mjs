import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportRenewalCancellationRequested} from '../lib/support-policy.ts';
import {supportBillingComplaintReply} from '../lib/support-billing-complaints.ts';
import {supportCallRecordingReply} from '../lib/support-call-recordings.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
const ask=(kind,messages,extra={})=>replyToSupport({kind,messages,allowAI:false,...extra},async()=>{throw Error('Paid models forbidden');});
const failures=[];
for(const [name,run] of [
 ['seller introduction complaint',async()=>{for(const kind of ['account','access']){const r=await ask(kind,[user('My call recording is missing.'),operator('The recording is still under review.'),user('Sellers hang up when my bot says it is an AI agent. How do I fix that?')],{handedOff:true});assert.match(r.reply,/introduction/);assert.match(r.reply,/property and call time/);assert.match(r.reply,/truthful|truthfully/);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.doesNotMatch(r.reply,/will stop|pretend|hide.*AI|confirmed fix or completion time/);}}],
 ['blocked unsubscribe',async()=>{for(const kind of ['account','access']){const r=await ask(kind,[user('The checkout failed, but now my card is charged. I cannot log in and want to unsubscribe.')]);assert.match(r.reply,/has not cancelled/i);assert.match(r.reply,/date and amount/i);assert.doesNotMatch(r.reply,/new card|button beside|enter the newest code/i);assert.equal(r.managementReview,true);assert.equal(r.status,'open');}}],
 ['paused credit complaint',async()=>{for(const kind of ['account','access']){const r=await ask(kind,[user('Why are my work credits decreasing while the bot is paused?')]);assert.match(r.reply,/already.started|earlier work/i);assert.match(r.reply,/not.*(?:verified|confirmed)|haven.t confirmed/i);assert.match(r.reply,/pause.*(?:time|timestamp)|when.*paused/i);assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/\$0 in work credits|restore.*automatically/i);}}],
 ['frozen bot followup',async()=>{const r=await ask('account',[user('My bot froze.'),assistant('Is it Running or Paused?'),user('Running')]);assert.match(r.reply,/setting|Run\/Pause/);assert.match(r.reply,/not.*(?:prove|confirm)|can.t confirm/i);assert.doesNotMatch(r.reply,/Pause.*then.*Run|restart it/i);assert.equal(r.managementReview,true);}],
 ['no more deals',async()=>{const r=await ask('account',[user('My bot has not found any more deals.')]);assert.equal(r.managementReview,true);assert.doesNotMatch(r.reply,/no new deals may be available|new leads will/i);}],
 ['support phone',async()=>{const r=await ask('account',[user('The call recording is missing.'),operator('The recording remains under review.'),user('Can I have the support team phone number?')],{handedOff:true});assert.match(r.reply,/reply in this conversation/);assert.match(r.reply,/can.t promise a phone call/);}],
]){try{await run();}catch(e){failures.push(name+': '+e.message);}}
if(failures.length)throw Error(failures.join('\n'));
for(const q of ['Please unsubscribe me from my software subscription.','I want to unsubscribe from iCash X.'])assert.equal(supportRenewalCancellationRequested(q),true);
for(const q of ['Do not unsubscribe me.','I already unsubscribed.','Unsubscribe me from marketing emails.','How do sellers unsubscribe from texts?','How do I unsubscribe a seller?'])assert.equal(supportRenewalCancellationRequested(q),false,q);
for(const kind of ['account','access']){
 const history=[user('I cannot sign in and want to unsubscribe.'),assistant('Purchase review is needed.')];
 for(const q of ['So what do I do?','Do you need any information from me?']){const r=await ask(kind,[...history,user(q)],{handedOff:true});assert.match(r.reply,/date and amount/);assert.equal(r.status,'open');}
 for(const boundary of [user('How do I upload a custom voice?'),operator('The purchase was verified; use the existing recovery process.'),user('I got in now.')]){const r=await ask(kind,[...history,boundary,user('What do I do now?')]);assert.doesNotMatch(r.reply,/date and amount.*statement/);}
 for(const q of ['I want to change my payment card.','Unsubscribe me from seller texts.','I do not want to unsubscribe from my subscription.']){const r=await ask(kind,[user(q)]);assert.doesNotMatch(r.reply,/sign.in is blocked|purchase and cancellation review/);}
 const billing=[user('My credits decreased after I paused my bot.'),assistant('The charge timing needs review.')];
 for(const boundary of [user('How do I change my voice?'),operator('The ledger review is complete.'),user('That worked.')]){const r=await ask(kind,[...billing,boundary,user('What now?')]);assert.doesNotMatch(r.reply,/pause timestamp|already.started work/);}
 for(const q of ['My video froze.','My seller froze the price.','My bot is working fine now.','How do I find deals?']){const r=await ask(kind,[user(q)]);assert.doesNotMatch(r.reply,/lack of progress is frustrating/);}
}
const blockedHistory=[user('My payment attempt looked unsuccessful. Now I see a card charge, cannot log in, and want to unsubscribe.'),assistant('What does the new card button say?'),user('I would like management to review this conversation.'),assistant('Flagged for review.'),user('There is no new card. I want to unsubscribe from the software.'),assistant('This needs review.')];
for(const q of ['So what do I do?','Oh, okay, I am sorry, so do you need information from me?','I don’t have to give you info? Or anything?']){const r=await ask('access',[...blockedHistory,user(q)],{handedOff:true});assert.match(r.reply,/date and amount/);assert.doesNotMatch(r.reply,/button|selected for billing/);}
const activityHistory=[user('The bot froze.'),assistant('Is the bot Running or Paused?'),user('Running'),assistant('Try Pause and Run. Does that work?')];
assert.equal((await ask('account',[...activityHistory,user('How would I know that?')])).managementReview,true);
assert.doesNotMatch((await ask('account',[...activityHistory,operator('The issue is now with video playback.'),user('How would I know that?')])).reply,/lack of progress/);
const pausedCheck={key:'work',source:'icash_accounts',status:'attention',code:'paused',detail:'Paused',observedAt:'2026-01-01T00:00:00Z'};
const complaint=[user('My credits went down while my bot was paused.')];
assert.match((await ask('account',complaint,{evidence:[pausedCheck]})).reply,/check confirms your bot is paused/);
assert.doesNotMatch((await ask('access',complaint,{evidence:[pausedCheck]})).reply,/check confirms your bot is paused/);
assert.match((await ask('account',complaint,{evidence:[{...pausedCheck,code:'not_paused',status:'ok'}]})).reply,/not paused now/);
assert.match((await ask('account',complaint,{evidence:[{...pausedCheck,status:'unknown'}]})).reply,/haven.t verified/);
// A current cancellation or duplicate charge retains its independent workflow.
for(const q of ['My credits decreased while paused; cancel my subscription.','My credits decreased while paused and my card was charged twice.']){const r=await ask('account',[user(q)]);assert.doesNotMatch(r.reply,/When did you pause/);assert.match(r.reply,/cancel|statement|duplicate/i);}
const noHandoff=await ask('account',[user('Can I have the support team phone number?')],{handedOff:false});assert.doesNotMatch(noHandoff.reply,/case is still in management review/);
for(const q of ['Sellers do not hang up during the AI introduction.','What if sellers hang up after the AI introduction?','Buyers hang up during the introduction.','Cancel my subscription; sellers hang up during the AI introduction.','How do I change my custom voice?'])assert.equal(supportCallRecordingReply({kind:'account',messages:[user(q)]}),null,q);
const switched=await ask('account',[user('Sellers hang up during the AI introduction.'),assistant('Which property and call time?'),user('How do I change my city?')]);assert.doesNotMatch(switched.reply,/separate call-quality issue/);
console.log('PASS current intent: blocked unsubscribe, paused-credit review, missing activity and support contact; negative/operator/topic boundaries.');

assert.equal(supportRenewalCancellationRequested('My email code is missing and I want to unsubscribe.'),true);
for(const q of ['My bot is paused but my credits never decreased.','My bot is paused and credits were not used.','My bot is not paused and credits are decreasing.'])assert.equal(supportBillingComplaintReply({kind:'account',messages:[user(q)]}),null,q);
