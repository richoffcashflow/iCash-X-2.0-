// Fictional support conversations. No network, paid models or messages.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}), agent=content=>({role:'assistant',content});
const evidence=[{key:'outreach',source:'fixture',observedAt:new Date().toISOString(),...supportOutreachEvidence({
 screened:10,outboundProperties:10,inboundProperties:0,contactProperties:7,textsSent:4,textsDelivered:0,textReplies:0,callsStarted:2,callsBudgetHeld:0,progress:null
})}];
const answer=(question,history=[],extra={})=>replyToSupport({kind:'account',messages:[...history,user(question)],evidence,allowAI:false,...extra});
for(const question of ['Please connect me with a supervisor','I would like management to review this conversation.','I need a human','Live help','Please escalate my ticket']){
 const result=await answer(question);
 assert.equal(result.managementReview,true,question);assert.equal(result.status,'open');assert.match(result.reply,/management review/);assert.doesNotMatch(result.reply,/will (?:respond|reply|call)|within .*hours/i);
}
const charge=await answer('I do not recognize this charge. Please cancel my subscription.');
assert.match(charge.reply,/statement/);assert.match(charge.reply,/Cancel subscription/);assert.equal(charge.status,'open');assert.equal(charge.managementReview,true);
const duplicate=await answer('I was charged twice. Stop my subscription.');
assert.match(duplicate.reply,/dates and amounts/i);assert.match(duplicate.reply,/Cancel subscription/);assert.equal(duplicate.managementReview,true);
const amounts=await answer('Both were $19.50 on 05/02.',[user('I was charged twice'),agent(duplicate.reply)],{handedOff:true});
assert.match(amounts.reply,/details you supplied/);assert.doesNotMatch(amounts.reply,/what dates|what are you trying/i);
assert.equal((await answer('Can I talk to a homeowner about a house?')).managementReview,undefined);
const unrelated=await answer('Can the bot talk to a human seller?');
assert.equal(unrelated.managementReview,undefined);
const previous=await answer('Why am I not getting replies yet?');
assert.match(previous.reply,/4 texts were accepted.*0 texts have delivery confirmations/);assert.doesNotMatch(previous.reply,/seller interest|wait|what are you trying/i);
const stuck=await answer('I am still not getting replies',[user('Why am I not getting replies yet?'),agent(previous.reply)]);
assert.equal(stuck.managementReview,true);assert.match(stuck.reply,/4 texts were accepted/);
assert.match((await answer('How many replies? I have not received any replies',[],{evidence:[]})).reply,/can’t verify/);
const course=await answer('What area code does the bot look for homes in?');
assert.match(course.reply,/markets automatically/);assert.doesNotMatch(course.reply,/sign.in|browser/);
assert.match((await answer('Can I call the seller myself while the bot is running?')).reply,/you speak through your browser microphone/i);
assert.match((await answer('Can I change how my bot speaks to sellers?')).reply,/Customize bot → Custom voice/);
assert.match((await answer('Where is the buyers section?')).reply,/Buyers inside that property/);
assert.match((await answer('Are these real people and leads?')).reply,/property research/);
const audio=await answer('The seller can hear me but I cannot hear them.');
assert.match(audio.reply,/Mute controls your microphone/);
const device=await answer('iPhone and Safari',[user('The seller can hear me but I cannot hear them.'),agent(audio.reply)]);
assert.match(device.reply,/property and approximate call time/);assert.doesNotMatch(device.reply,/permission|Which device/);
const vip=await answer('I did',[user('I paid for VIP but it is not active'),agent('Email your VIP purchase receipt so it can be verified.')]);
assert.equal(vip.managementReview,true);assert.match(vip.reply,/said you sent the receipt/);
const missing=await answer('Please issue me a code',[user('I entered my purchase email and got no code'),agent('Your code delivery is unconfirmed.')],{kind:'access'});
assert.equal(missing.managementReview,true);assert.doesNotMatch(missing.reply,/Which device|email on your.*receipt|code has been sent/i);
const repeated=await answer('That is all I know',[user('Unknown problem'),agent('I don’t have a confirmed answer to that yet.'),user('I explained it'),agent('I don’t have a confirmed answer to that yet.')]);
assert.equal(repeated.managementReview,true);assert.doesNotMatch(repeated.reply,/what are you trying/i);
const topicChange=await answer('How do I change my bot voice?',[user('I need management review'),agent('Your case is in management review.')],{handedOff:true});
assert.match(topicChange.reply,/Custom voice/);assert.doesNotMatch(topicChange.reply,/repeat|need a receipt/);
const resolved=await answer('That worked',[user('My browser call failed'),agent('Try selecting the output on the device.')]);
assert.equal(resolved.status,'resolved');assert.equal(resolved.managementReview,undefined);
console.log('Passed account and guest support review, delivery, product and billing conversation replays.');
