// Anonymized multi-turn cases. No customer messages, external models or paid work.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
import {supportProductConflict} from '../lib/support-product-conflicts.ts';
import {supportContactTimingQuestion} from '../lib/support-product-clarifications.ts';
import {supportQualityReport} from '../lib/support-quality.ts';
import {supportCurrentStepReply} from '../lib/support-current-step.ts';
import {supportManagementReview} from '../lib/support-management-review.ts';
const user=content=>({role:'user',content}),agent=content=>({role:'assistant',content});
const evidence=[{key:'work',code:'not_paused',status:'ok',source:'fixture',observedAt:'2026-11-07T16:00:00Z',detail:'Bot is switched on.'},{key:'outreach',source:'fixture',observedAt:'2026-11-07T16:00:00Z',...supportOutreachEvidence({screened:12,outboundProperties:12,inboundProperties:0,contactProperties:8,textsSent:9,textsDelivered:6,textReplies:1,callsStarted:5,callsBudgetHeld:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'},remainingCents:900,spentCents:100}})}];
const priorEnv={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let requests=0,checks=0;
const noModel=async()=>{requests++;throw Error('Unexpected model request');};
async function reply(q,history=[],extra={}){checks++;return replyToSupport({kind:'account',messages:[...history,user(q)],evidence,...extra},noModel);}
try{
 for(const q of ['When is it okay for me to contact seller?','When can I call the owner myself?']){
  const r=await reply(q);assert.match(r.reply,/Take over/);assert.match(r.reply,/Return to bot/);assert.doesNotMatch(r.reply,/number is available|looks up/);
  assert.equal(supportContactTimingQuestion(q),false);
 }
 assert.equal(supportContactTimingQuestion('When do contact details show up?'),true);
 assert.match((await reply('Why are all the ZIP codes the same?')).reply,/does not confirm why/);
 assert.match((await reply('How to change location')).reply,/no city, state or ZIP-code selector/);
 for(const q of ['Does the software work over the weekend?','Will my bot work on Saturday and Sunday?'])assert.match((await reply(q)).reply,/weekends.*9 AM–9 PM/);
 for(const q of ['How many times will the AI reach out to leads on a daily basis?','Does the bot follow up with every seller daily?','Will the bot re-contact them?']){
  const r=await reply(q);assert.match(r.reply,/at most one follow-up 3–5 days/);assert.match(r.reply,/Return to bot/);
 }
 const followup=await reply('So every day?',[user('Will the bot follow up with them?'),agent('It follows up every day until they reply.')]);
 assert.match(followup.reply,/does not contact every seller every day/);
 const names=[user('Seller 1 legal name is mine or the property owner’s?'),agent('Use the seller’s legal name.')];
 assert.match((await reply(names[0].content)).reply,/Enter or correct it in Send for signatures/);
 assert.match((await reply('Do I put it manually?',names)).reply,/Enter or correct it/);
 assert.match((await reply('How do I put a price I want or does the bot do that')).reply,/price|offer/i);
 assert.match((await reply('How do I adjust the price?')).reply,/unsigned purchase agreement.*Purchase price/);
 const signing=await reply('How will I know when I have a contract to sign myself?');
 assert.match(signing.reply,/every required seller signs first.*Review & sign/);
 assert.match((await reply('I have to wait until they do it first?',[user('How will I know when I have a contract to sign myself?'),agent(signing.reply)])).reply,/seller signs first/);
 assert.match((await reply('How do I confirm the seller’s date?')).reply,/closing date.*call or visit/);
 assert.match((await reply('How do I let the AI bot know about details?')).reply,/Which details/);
 for(const q of ['How do I get into platform buyers network?','VIP is active. How do I find the buyer network?'])assert.match((await reply(q)).reply,/hidden before then, even with VIP active/);
 assert.match((await reply('Where do all my leads go after a day, do they disappear?')).reply,/All activity/);
 assert.match((await reply('How often does the bot generate new listings of properties?')).reply,/not arrive on a fixed schedule/);
 const review=await reply('When I press review under Needs you nothing pops up');
 assert.match(review.reply,/still a software issue/);assert.notEqual(review.status,'resolved');
 const blocked=await reply('The follow up is blocked',[user('I reviewed the alert but it still shows'),agent('What message does it show?')]);
 assert.match(blocked.reply,/does not restart outreach/);assert.notEqual(blocked.status,'resolved');
 const phone=await reply('I did. None of them answer the phone',[user('Nobody is responding'),agent('Open the property’s Texts and Calls to review its actual conversation.')]);
 assert.match(phone.reply,/5 call attempts/);assert.match(phone.reply,/which property and approximate call time/i);assert.doesNotMatch(phone.reply,/6 texts|1 seller text reply/);
 for(const q of ['For what?','Why?','Review?','Anything yet?','How long will it take?']){
  const r=await reply(q,[user('Automated work is delayed and restart time is unconfirmed.'),agent('Your case is still in management review.')],{handedOff:true});
  assert.match(r.reply,/bot’s work is delayed or missing/);assert.match(r.reply,/don’t have a confirmed fix or completion time/);assert.equal(r.managementReview,true);
 }
 const contact=await reply('Will I be contacted?',[user('My bot is not working'),agent('Your case is still in management review.')],{handedOff:true});
 assert.match(contact.reply,/Management can reply in this conversation/);assert.doesNotMatch(contact.reply,/will contact|will call|within/);
 const sideQuestion=[user('My bot is not working'),agent('Your case is still in management review.'),user('How do I sign a purchase agreement?'),agent('Every required seller signs first, then you can Review & sign.')];
 assert.match((await reply('Any update?',sideQuestion,{handedOff:true})).reply,/bot’s work is delayed or missing/);
 const sideAnswer={reply:'Purchase agreements require the seller signatures before your review.',status:'open',ai:false};
 assert.deepEqual(supportManagementReview({kind:'account',messages:[...sideQuestion,user('Why?')],handedOff:true},sideAnswer),sideAnswer);
 const down=await reply('Is my bot down?',[user('There is nothing today'),agent('Your case is still in management review.')],{handedOff:true});
 assert.match(down.reply,/last check hadn’t recorded a recent completed task/);assert.equal(down.status,'open');
 const signIn=[user('I paid but the sign-in code never came'),agent('Does the email on your receipt match?')];
 const noReceipt=await reply('I did not get an email; it just took money out of my account',signIn,{kind:'access',contactKnown:true});
 assert.match(noReceipt.reply,/bank or card statement/);assert.doesNotMatch(noReceipt.reply,/check the email on.*receipt|what are you trying/);
 const payment=await reply('The payment date is today for $50',[...signIn,agent('What are the payment date and amount on your receipt?')],{kind:'access'});
 assert.doesNotMatch(payment.reply,/Added money|prepaid work credits/);assert.match(payment.reply,/access|sign-in/i);
 const receiptAgain=await reply('What should I do if I didn’t receive my receipt?',[...signIn,user('Today for $50'),agent('Your case is still in management review.')],{kind:'access',handedOff:true});
 assert.match(receiptAgain.reply,/payment details you shared/);assert.equal(receiptAgain.managementReview,true);
 const checkedPayment=await reply('I never received my receipt',[...signIn,{role:'operator',content:'Payment matched. The checkout email differs from the sign-in email.'}],{kind:'access'});
 assert.match(checkedPayment.reply,/payment check already recorded/);assert.doesNotMatch(checkedPayment.reply,/What payment date|still need to be matched/);
 const failedCode=await reply('No it didn’t',[user('No code arrived'),agent('Request one fresh code. Does it arrive?')],{kind:'access'});
 assert.doesNotMatch(failedCode.reply,/what are you trying|enter the newest code/i);
 // A new topic and actual cancellation bypass old receipt/follow-up questions.
 assert.match((await reply('Where is the course?',signIn,{kind:'access'})).reply,/Course/);
 assert.match((await reply('Cancel my subscription',names)).reply,/Cancel subscription/);
 assert.equal(supportCurrentStepReply({kind:'account',messages:[user('When do I sign my buyer assignment agreement?')]}),null);
 assert.equal(supportCurrentStepReply({kind:'account',messages:[user('All the ZIP codes are the same and my bot is not calling')]}),null);
 assert.equal(supportCurrentStepReply({kind:'account',messages:[user('How do I sign a purchase agreement?'),agent('The seller signs first.'),user('What do I do first to change my email?')]}),null);
 assert.equal(supportCurrentStepReply({kind:'account',messages:[user('Will the bot follow up?'),agent('Eligible follow-up uses its own timing.'),user('Where can I watch the course again?')]}),null);
 const actualFailure=await reply('The bot is not calling sellers today');
 assert.doesNotMatch(actualFailure.reply,/at most one follow-up/);assert.equal(actualFailure.status,'open');
 // Model rejection and the quality report share the same source-backed boundaries.
 for(const [q,a] of [
  ['How often does it follow up?','The bot follows up with every seller every day until they reply.'],
  ['Do I enter the seller legal name?','You cannot enter the seller name manually.']
 ])assert.equal(supportProductConflict(a,q),true);
 assert.equal(supportProductConflict('The bot does not contact every seller every day until they reply.'),false);
 const flagged=supportQualityReport([{id:'fictional',kind:'account',subject:'follow-up',status:'open',updated_at:'2026-11-07T16:00:00Z',messages:[{role:'user',content:'How often does it follow up?',created_at:'2026-11-07T16:00:00Z'},{role:'assistant',content:'The bot follows up with every seller every day until they reply.',created_at:'2026-11-07T16:00:01Z'}]}],new Date('2026-11-07T17:00:00Z'));
 assert.ok(flagged.cases[0].flags.some(f=>f.code==='mismatch'));
 assert.equal(requests,0,'known cases must use no paid model calls');
}finally{process.env=priorEnv;}
console.log(`PASS ${checks} support current-step replays, intent boundaries and quality signals.`);
