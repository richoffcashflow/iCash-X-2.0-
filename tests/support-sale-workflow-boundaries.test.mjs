import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportAccountReviewReply} from '../lib/support-account-review.ts';
import {supportCurrentStepReply} from '../lib/support-current-step.ts';
const user=content=>({role:'user',content}),operator=content=>({role:'operator',content});
let calls=0;const deny=async()=>{calls++;throw Error('No external models');};
for(const kind of ['account','access'])for(const handedOff of [false,true]){
 for(const q of ['How soon can somebody close a 1st sell using the platform?','How soon can someone make their first sale using this platform?','How long does it takes for a sell to go through?']){
  const r=await replyToSupport({kind,handedOff,messages:[user('My bot is not contacting leads.'),operator('The missing outreach remains under review.'),user(q)],evidence:[]},deny);
  assert.match(r.reply,/no guaranteed time/i);assert.match(r.reply,/closing/);assert.notEqual(r.status,'resolved');assert.doesNotMatch(r.reply,/confirmed fix or completion time/);
 }
 for(const q of ['At what point does my bot start outreach on the properties it found? All my credits seem to go to research. What about the rest of the wholesale process?','When does my bot start outreach? Only research seems to use my credits. Does it handle the rest of wholesaling?']){
  for(const paused of [true,false]){
   const evidence=[{key:'work',status:'ok',code:paused?'paused':'not_paused'},{key:'outreach',status:'ok',outreach:{screened:12,callsStarted:2,textsSent:3}}];
   const r=await replyToSupport({kind,handedOff,messages:[operator('An earlier charge is still under review.'),user(q)],evidence},deny);
   assert.match(r.reply,/eligible sellers/);assert.match(r.reply,/closing requests/);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
   if(kind==='account'){assert.match(r.reply,/12 properties/);if(paused)assert.match(r.reply,/currently paused/);}else assert.doesNotMatch(r.reply,/12 properties|currently paused/);
   assert.doesNotMatch(r.reply,/will start|buy more|\$0 in work credits/);
  }
 }
}
for(const q of ['How long until my refund goes through?','How long does a sale take? My bot is broken.','How fast can I sell my car?','The seller asked how fast a sale happens.','How long until my access is restored?'])assert.doesNotMatch(supportCurrentStepReply({kind:'account',messages:[user(q)]})?.reply??'',/no guaranteed time to a first sale/i);
for(const q of ['Cancel my subscription. Does the bot handle outreach and the rest of the wholesale process?','My card has an unrecognized charge. Does the bot handle outreach and everything else?','The seller asked about outreach and everything else.','How do I add work credits?','Does my bot handle outreach and everything else?','What if all my credits go to research; does my bot do outreach and everything else?','My bot is working fine; not all credits go to research. Does it handle outreach and everything else?'])assert.doesNotMatch(supportAccountReviewReply({kind:'account',messages:[user(q)]})?.reply??'',/bot is designed to research/i);
const changed=await replyToSupport({kind:'account',handedOff:true,messages:[user('When does my bot start outreach and handle the rest of wholesaling?'),operator('The issue remains under review.'),user('Cancel my subscription.')],evidence:[]},deny);assert.doesNotMatch(changed.reply,/bot is designed to research/);assert.match(changed.reply,/cancel/i);
assert.equal(calls,0);console.log('PASS first-sale timing and research/outreach boundaries; no external calls');
