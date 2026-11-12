import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportLocationParts} from '../lib/support-location-guidance.ts';
const user=content=>({role:'user',content});
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'Switched on.',source:'fictional'},
 {key:'outreach',status:'ok',detail:'Saved checks.',source:'fictional',outreach:{screened:0,callsStarted:0,textsSent:0,textReplies:0,progress:{status:'ready',spendingMode:'available_balance',remainingCents:2300,pendingCents:0,health:{status:'blocked',reason:'no_completed_work'}}}}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional';process.env.ICASH_SUPPORT_AI_MODEL='fictional';
let calls=0;const forbidden=async()=>{calls++;throw Error('No paid model requests');};
const ask=(q,extra={})=>replyToSupport({kind:'account',messages:[user(q)],evidence,...extra},forbidden);
for(const q of ['Is my bot currently searching for properties? Also, how can I set my preferred search location around Madison, Wisconsin?',
 'How can I select a search location? My bot is not doing anything.',
 'My bot is not doing anything and how do I choose a city for leads?']){
 const r=await ask(q);assert.match(r.reply,/markets automatically/);assert.match(r.reply,/no city, state or ZIP-code selector/);assert.match(r.reply,/no completed work/);assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.equal(r.ai,false);
 const fallback=supportConversationFallback({kind:'account',messages:[user(q)],evidence});assert.equal(fallback.reply,r.reply);
}
for(const kind of ['account','access']){
 const r=await ask('How much work credits do I have left? How do I set my preferred search location?',{kind});
 assert.match(r.reply,/markets automatically/);assert.equal(r.status,'open');
 if(kind==='account')assert.match(r.reply,/\$23\.00/);else{assert.match(r.reply,/can.t verify an account balance/);assert.doesNotMatch(r.reply,/\$23\.00/);}
 const single=await ask('How can I set my preferred search location?',{kind});assert.match(single.reply,/markets automatically/);assert.doesNotMatch(single.reply,/call attempts|\$23/);
}
const unknown=await ask('Is my bot currently searching for properties? How can I choose the search location?',{evidence:[]});assert.match(unknown.reply,/can.t verify current research/);assert.match(unknown.reply,/markets automatically/);assert.doesNotMatch(unknown.reply,/no completed work/);
const paused=await ask('Is my bot currently searching for properties? How do I choose my search location?',{evidence:[{...evidence[0],code:'paused'},evidence[1]]});assert.match(paused.reply,/bot is paused/);assert.match(paused.reply,/markets automatically/);assert.doesNotMatch(paused.reply,/has resumed/);
for(const [q,expected] of [['Cancel my subscription. How can I set my search location?',/Cancel subscription/],['Refund my payment. How can I choose my search location?',/All sales are final/]]){
 const r=await ask(q);assert.match(r.reply,expected);assert.match(r.reply,/markets automatically/);assert.equal(r.status,'open');
}
for(const q of ['Where is the course?','Cancel my subscription','How do I upload leads?','How do I change my phone number?']){
 const r=await ask(q,{allowAI:false,messages:[user('How do I select a search location?'),{role:'operator',content:'An unrelated sign-in fault remains under review.'},user(q)]});assert.doesNotMatch(r.reply,/markets automatically|no city, state/);
}
const negative=['How do I change a buyer search location?','Where is the location on the contract?','How do I import leads in Ohio?','Why is my bot not calling leads in this city?'];
for(const q of negative)assert.equal(supportLocationParts({kind:'account',messages:[user(q)]}),null,q);
const operator=await ask('Is my bot currently searching for properties? How do I choose a search location?',{handedOff:true,messages:[{role:'operator',content:'The activity fault remains unresolved; no restart is confirmed.'},user('Is my bot currently searching for properties? How do I choose a search location?')]});assert.equal(operator.managementReview,true);assert.match(operator.reply,/still in management review/);assert.match(operator.reply,/markets automatically/);
assert.equal(calls,0);
console.log('PASS mixed location and evidence replies; account/guest, unknown, Pause, operator and topic boundaries; offline only');
