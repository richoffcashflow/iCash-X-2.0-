import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {membershipAccessible} from '../lib/membership-policy.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const original='Hello. I tried accepting the offer with two months free then $50 per month link. It’s not going through. Wanted to inform you asap.';
const first='I am reaching out to you guys in regards to the payment email that was used ([email removed]). I attempted to checkout with the free two-month offer and it did not go through. I need someone to look into this asap. Thanks.';
const followup="When I try to sign in with my email on file, it basically says that it doesn't work and to reach out to you guys for support. Again, this is for the first two months free and then after those two months are done, then it's $50/month going forward.";
const bad='What happens when you try to sign in: no code arrives, the code is rejected, or you get stuck after entering it?';
let modelCalls=0;const noModel=async()=>{modelCalls++;throw Error('No paid model');};
for(const kind of ['access','account']){
 const context={kind,contactKnown:true};
 for(const message of [original,first]){
  const answer=await replyToSupport({...context,messages:[user(message)]},noModel);
  assert.match(answer.reply,/two-month offer checkout/);assert.match(answer.reply,/exact message/);
  assert.match(answer.reply,kind==='account'?/signed-in account/:/email attached/);
  assert.doesNotMatch(answer.reply,/newest code|which device|which browser|what.*email|send.*email|receipt|legacy-offer/i);
  assert.notEqual(answer.status,'resolved');
 }
 const history=[user(first),assistant(bad),user(followup)];
 const answer=await replyToSupport({...context,messages:history},noModel);
 assert.match(answer.reply,/Resume a checkout from another device/);assert.doesNotMatch(answer.reply,/Thanks.*code|which device|newest code|purchase receipt/i);assert.equal(answer.status,'open');
 for(const text of ['Still does not work','Same error','I already tried that','It says contact support']){
  const next=await replyToSupport({...context,messages:[...history,assistant(answer.reply),user(text)]},noModel);
  assert.match(next.reply,/don’t need to repeat/);assert.equal(next.status,'open');assert.doesNotMatch(next.reply,/\?|newest code|Which browser/);
 }
 for(const next of ['Where is the course?','My bot is not calling','Cancel my subscription','Refund my payment','My email code has not arrived','Does this work in Canada?']){
  const answer=supportConversationFallback({...context,messages:[...history,user(next)]});assert.doesNotMatch(answer.reply,/two-month offer checkout|Resume a checkout/,next);
 }
 const fixed=supportConversationFallback({...context,messages:[...history,user('That worked')]});assert.equal(fixed.status,'resolved');
 const identity=await replyToSupport({...context,messages:[user('You already have my email')]},noModel);assert.match(identity.reply,/don’t need to send.*email|don’t need to send it again/);assert.equal(identity.status,'open');
 const claim=supportConversationFallback({...context,messages:[user('I bought iCash X 1.0. Give me the free two-month offer.')]});assert.match(claim.reply,/receipt/);assert.doesNotMatch(claim.reply,/legacy-offer|Resume a checkout/);
}
assert.equal(modelCalls,0);
let membership={state:'active',price_cents:5000,legacy_trial_started_at:new Date().toISOString(),legacy_trial_end:new Date(Date.now()+86400000).toISOString(),paid_through:new Date(Date.now()+86400000).toISOString()};
const unavailable=()=>{throw Error('Unrelated fixture check unavailable');};
const {collectSupportDiagnostics}=await loadService('lib/support-diagnostics.ts',{accountMembership:async id=>{assert.equal(id,'owned-account');return membership;},membershipAccessible,db:unavailable,fundingMode:()=> 'live',launchReadiness:unavailable,readCourseProgress:unavailable,courseProgressEvidence:unavailable,supportOutreachEvidence:unavailable,supportVoiceEvidence:unavailable});
let subscription=(await collectSupportDiagnostics('owned-account')).find(e=>e.key==='subscription');assert.equal(subscription.code,'free_period_active');assert.match(subscription.detail,/two-month free.*\$50\/month/);assert.doesNotMatch(subscription.detail,/Paid access is recorded/);
membership={...membership,state:'needs_review'};subscription=(await collectSupportDiagnostics('owned-account')).find(e=>e.key==='subscription');assert.equal(subscription.status,'attention');assert.equal(subscription.softwareAccess,false);
membership={...membership,state:'cancelled',cancel_at_period_end:true};subscription=(await collectSupportDiagnostics('owned-account')).find(e=>e.key==='subscription');assert.match(subscription.detail,/Future renewals are stopped/);
console.log('PASS exact offer failure replay in both chats, attached identity, failed-step memory, topic changes, real resolution and original-purchase proof boundary. No provider calls.');
