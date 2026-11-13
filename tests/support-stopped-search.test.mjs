import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportMissingActivityConcern} from '../lib/support-account-review.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const evidence=[{key:'work',status:'ok',code:'not_paused'}, {key:'outreach',status:'ok',outreach:{screened:17,contactProperties:4,callsStarted:3,textsSent:7,textsDelivered:2,textReplies:1,progress:{status:'ready',health:{status:'ok'}}}}, {key:'research_capacity',status:'attention',code:'research_capacity_wait'}];
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,handedOff:true,allowAI:false,...extra},async()=>{throw Error('Paid calls forbidden');});
for(const q of ['My bot has stopped searching.', 'The AI stopped researching properties.', 'My bot stopped finding new leads.']){
 assert.equal(supportMissingActivityConcern(q),true);
 const r=await ask([u(q)]);assert.match(r.reply,/waiting for capacity/i);assert.equal(r.managementReview,true);assert.equal(r.status,'open');
 assert.doesNotMatch(r.reply,/no (?:eligible )?leads|hasn.t started/i);
}
for(const q of ['How do I resume my AI so it can work again?', 'What do I need to do to restart my bot?']){
 const r=await ask([u('My bot has stopped searching.'),o('The research check is waiting for service capacity; no restart time is confirmed.'),u(q)]);
 assert.match(r.reply,/already switched on/i);assert.match(r.reply,/capacity/i);assert.match(r.reply,/not.*(?:repair|clear)|won.t.*(?:repair|clear)/i);assert.equal(r.status,'open');
 const paused=await ask([u(q)],{evidence:[{key:'work',status:'attention',code:'paused'}]});assert.match(paused.reply,/Run bot/);assert.doesNotMatch(paused.reply,/already switched on/i);
 const unknown=await ask([u(q)],{evidence:[]});assert.match(unknown.reply,/can.t confirm/i);assert.doesNotMatch(unknown.reply,/already switched on|Select Run bot/i);
}
const texts=await ask([u('Are things working? I cannot find the exact texts the bot sent, and I have no interested sellers.')]);
assert.match(texts.reply,/Texts/);assert.match(texts.reply,/2 of 7/);assert.match(texts.reply,/not.*(?:interest|wants to sell)|not.*interested/i);assert.doesNotMatch(texts.reply,/outreach hasn.t started/i);assert.equal(texts.status,'open');
const repeated=await ask([u('I cannot see my sent texts.'),o('Open the property and select Texts.'),u('I still cannot see the texts the bot sent.')]);
assert.doesNotMatch(repeated.reply,/Open the property/i);assert.match(repeated.reply,/Which property/);
const unknownTexts=await ask([u('I cannot see my sent texts.')],{evidence:[]});assert.match(unknownTexts.reply,/can.t verify saved texts/i);assert.doesNotMatch(unknownTexts.reply,/2 of 7/);
for(const q of ['My bot stopped searching yesterday but is working now.', 'I do not think my bot has stopped searching.', 'My browser stopped searching.', 'The seller stopped replying.', 'How do I restart the course video?', 'Do not restart my bot.', 'I want to restart my subscription.']){
 assert.equal(supportMissingActivityConcern(q),false);
 assert.doesNotMatch((await ask([u(q)])).reply,/already switched on|buying more credits won.t|current research.*capacity/i);
}
for(const q of ['Where is the course?', 'Cancel my subscription.'])assert.doesNotMatch((await ask([u('My bot stopped searching.'),u(q)])).reply,/already switched on|waiting for capacity/i);
assert.doesNotMatch((await ask([u('How do I resume my AI so it can work again?')],{kind:'access'})).reply,/already switched on|3 call attempts/i);
console.log('PASS fictional stopped research, restart, missing texts and topic boundaries; no paid calls');
