// Fictional multi-turn cases from the current support review. No live requests.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportAccountReviewReply} from '../lib/support-account-review.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
import {supportProductConflict} from '../lib/support-product-conflicts.ts';
import {supportMissingSellerContactQuestion} from '../lib/support-lead-policy.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
const observedAt='2026-11-08T16:00:00Z';
const work={key:'work',code:'not_paused',status:'ok',detail:'Bot is switched on.',source:'fixture',observedAt};
const outreach={key:'outreach',source:'fixture',observedAt,...supportOutreachEvidence({screened:24,outboundProperties:24,inboundProperties:0,contactProperties:0,textsSent:0,textsDelivered:0,textReplies:0,callsStarted:0,callsBudgetHeld:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'},remainingCents:1600,spentCents:400}})};
const evidence=[work,outreach];
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let modelCalls=0,replays=0;
const noModel=async()=>{modelCalls++;throw Error('No external model allowed');};
async function reply(q,history=[],extra={}){replays++;return replyToSupport({kind:'account',messages:[...history,user(q)],evidence,...extra},noModel);}
try{
 const slow='My bot is constantly running but it seems slow and not doing much. I have not gotten interested sellers. I liked the original iCash X better than 2.0.';
 const complaint=await reply(slow);
 assert.match(complaint.reply,/lack of progress|frustrating/);assert.match(complaint.reply,/0 call attempts/);assert.doesNotMatch(complaint.reply,/purchase proof|two calendar months|receipt|which screen|What are you trying/i);assert.equal(complaint.managementReview,true);
 for(const q of ['That sucks','Nothing']){const r=await reply(q,[user(slow),assistant(complaint.reply)]);assert.notEqual(r.status,'resolved');assert.match(r.reply,/remains (?:open|unresolved)/);assert.doesNotMatch(r.reply,/What are you trying/);}
 const technical='My bot has researched properties with 0 calls, 0 texts and 0 seller replies. Are automated AI calling and SMS available and enabled on my account? What is the exact blocker? I want the bot to speak, not a manual call. Which outbound number will sellers see and is it my personal account phone?';
 const checked=await reply(technical);
 for(const pattern of [/can run automatically/,/Call button is for you/,/0 call attempts and 0 texts/,/haven’t verified the specific cause/,/service-connected business number/])assert.match(checked.reply,pattern);
 assert.doesNotMatch(checked.reply,/That is the seller’s contact number|everything is working|setup is complete/i);assert.equal(checked.managementReview,true);
 const pausedEvidence=[{...work,code:'paused',status:'attention'}, {...outreach,outreach:{...outreach.outreach,progress:{...outreach.outreach.progress,status:'paused'}}}];
 const pause=await reply('I have paused my bot after 0 calls. Keep it paused. Are automated calls enabled, and what is the blocker before I resume?',[user(technical),assistant(checked.reply)],{evidence:pausedEvidence,handedOff:true});
 assert.match(pause.reply,/has not resumed/);assert.match(pause.reply,/not why outreach was missing before/);assert.doesNotMatch(pause.reply,/Select Run|press Run|\bI(?:’ve|'ve| have)? resumed/i);
 for(const q of ['What number will it call? My business number?','How do I setup a previously purchased number for it to use?','Which outbound number will the seller see?','Can I connect my own number for the bot to use?']){
  const r=await reply(q);assert.match(r.reply,/not a caller-ID selector/);assert.match(r.reply,/don’t identify the exact outbound number/);assert.doesNotMatch(r.reply,/enter the number|use your personal|\+1\d/);
 }
 const location=await reply('Georgia',[user('How do I setup a previously purchased number for it to use?'),assistant('Enter the number in Settings. Where are you when trying to set this number?')]);
 assert.match(location.reply,/earlier phone-setup instruction was incorrect/);assert.doesNotMatch(location.reply,/choose.*state|selects.*markets|What are you trying/);
 for(const q of ['Even with VIP, I can let it do all the work mostly, right?','Does the bot do all the work?']){
  const r=await reply(q);assert.match(r.reply,/Standard as well as VIP/);assert.match(r.reply,/required signatures/);assert.match(r.reply,/does not remove those responsibilities/);
 }
 assert.match((await reply('Wow, thats unfortunate. So how does it work for me?')).reply,/required signatures/);
 for(const q of ['If I put more money will I get a contract?','If I put more money into my bot does it work differently?','Does buying more credits guarantee better results?']){
  const r=await reply(q);assert.match(r.reply,/does not guarantee a contract/);assert.match(r.reply,/do not fix a technical problem/);assert.doesNotMatch(r.reply,/What are you trying|VIP is required/);
 }
 for(const q of ['What to do if the property doesnt have a number?','Why don’t they have contact info?','The property does not have a phone number']){
  assert.equal(supportMissingSellerContactQuestion(q),true,q);
  const r=await reply(q);assert.notEqual(r.status,'resolved');assert.match(r.reply,/cannot be called or texted|neither you nor the bot can call or text/);assert.doesNotMatch(r.reply,/This is normal|appears later|texting yourself/);
 }
 const contactHistory=[user('The seller has no number'),assistant('A lead can appear before a usable seller number is available. Your account check shows no saved owner details yet.')];
 const next=await reply('So what I do next',contactHistory);assert.match(next.reply,/Which property is missing its number/);assert.doesNotMatch(next.reply,/Your account check shows/);
 for(const q of ['Searching for a deal, waiting','What is the bot doing currently? I have no contact information or cash buyers.','How do I know what its currently working on? These are lists, not interested sellers.']){
  const r=await reply(q);assert.match(r.reply,/0 call attempts/);assert.doesNotMatch(r.reply,/actively looking|hasn’t found one yet|After the required purchase signatures|add listings/);
 }
 const findings=[user('Why no seller replies?'),operator('I found a display problem: a property opens an empty contact thread although messages are saved. Work is tied to unfinished work awaiting final charges and blocking new work. A correction is tested but not live yet. I cannot confirm why sellers have not replied.')];
 const preserve=await reply('So there is an issue with why we are not getting quality responses from sellers?',findings);
 assert.match(preserve.reply,/earlier operator review/);assert.match(preserve.reply,/conversation visibility and work awaiting final charges/);assert.doesNotMatch(preserve.reply,/not due to a confirmed system error|Are you.*reviewing/i);assert.equal(preserve.managementReview,true);
 for(const q of ['Alright','Sorry for the delay, I’ve been traveling. Thank you for looking further into this.','Thanks for the update']){
  const r=await reply(q,[user('My bot is not calling'),assistant('Your case is still in management review.')],{handedOff:true});assert.match(r.reply,/^(Got it\.|You’re welcome\.)$/);assert.equal(r.status,'open');
 }
 const subscription={key:'subscription',code:'renewal_payment_failed',source:'icash_memberships',status:'attention',softwareAccess:false,observedAt,detail:'Software access is inactive.'};
 const payment={key:'membership_payments',code:'software_payments_recorded',source:'icash_membership_invoices',status:'ok',observedAt,detail:'Recorded software payments: $50.00 recorded 11/2/2026, 11:00:00 AM UTC (subscription cancelled).'};
 const accessHistory=[user('I paid but access is locked'),operator('I confirmed the payment and a cancellation. Saved terms end access on cancellation. I have not verified who initiated it.'),user('It locked without me cancelling')];
 for(const q of ['I did not cancel','Okay when will access be restored?','When will my account be unlocked?']){
  const r=await reply(q,accessHistory,{evidence:[subscription,payment]});assert.match(r.reply,/you said you did not cancel/);assert.match(r.reply,/cancellation record and access terms/);assert.match(r.reply,/Don’t pay again or restart/);assert.equal(r.managementReview,true);assert.notEqual(r.status,'resolved');
 }
 const cancellation=await reply('Cancel my subscription',accessHistory,{evidence:[subscription,payment]});assert.match(cancellation.reply,/Cancel subscription/);
 const course=await reply('Where is the course?',accessHistory,{evidence:[subscription,payment]});assert.match(course.reply,/Course/i);assert.doesNotMatch(course.reply,/cancellation record/);
 const legacy=await reply('I bought iCash X 1.0. How do I migrate?');assert.match(legacy.reply,/purchase receipt|purchase proof/);
 for(const q of ['How much money should I put as the purchase price in an agreement?','How do I change my personal phone number?','How do I change my own phone number in Settings?','Where is the course?'])assert.equal(supportAccountReviewReply({kind:'account',messages:[user(q)],evidence}),null,q);
 assert.equal(supportAccountReviewReply({kind:'account',messages:[operator('The display problem is corrected and now live. The repair is verified.'),user('Why are there no seller replies?')],evidence}),null);
 assert.equal(supportMissingSellerContactQuestion('My phone number is missing in Settings'),false);
 assert.equal(supportProductConflict('In Settings, enter the phone number you want the bot to use for calling and texting.'),true);
 assert.equal(supportProductConflict('Contact info appears later when it is found.'),true);
 assert.equal(supportProductConflict('Your Settings phone number is not a caller-ID selector.'),false);
 assert.equal(modelCalls,0,'known support scenarios must never call an external model');
}finally{process.env=env;}
console.log(`PASS ${replays} current support review replays, trusted findings and topic boundaries; no model calls.`);
