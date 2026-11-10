import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const operator={role:'operator',content:'The checkout screenshots were reviewed. The email correction remains open for review. Access has not been restored and there is no confirmed completion time. Do not pay again or resend the same proof.'};
for(const kind of ['account','access'])for(const handedOff of [false,true]){
 const r=await replyToSupport({kind,messages:[user('My checkout email has a typo.'),operator,user('Is there no timeframe for when my access will be granted?')],evidence:[],handedOff},async()=>{throw Error('Paid model forbidden');});
 assert.match(r.reply,/no confirmed completion time/i);assert.match(r.reply,/operator/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.doesNotMatch(r.reply,/enough information|send.*receipt|within.*hours/i);
}
for(const kind of ['account','access'])for(const q of ['How long until the seller grants access?','When will my refund arrive?','Cancel my subscription','How do I change my bot voice?','That worked, I am in now.']){
 const r=await replyToSupport({kind,messages:[operator,user(q)],evidence:[]},async()=>{throw Error('Paid model forbidden');});
 assert.doesNotMatch(r.reply,/operator’s last update/);
}
for(const messages of [[user(operator.content),user('When will access be granted?')],[operator,user('How does the bot call?'),user('When will access be granted?')],[{role:'operator',content:'Your access was restored.'},user('When will access be granted?')],[{role:'operator',content:'The refund review has not been granted. There is no confirmed completion time.'},user('When will access be granted?')]]){
 const r=await replyToSupport({kind:'access',messages,evidence:[]},async()=>{throw Error('Paid model forbidden');});assert.doesNotMatch(r.reply,/operator’s last update/);
}
for(const content of [
 'Access has been restored. The separate email correction review has not changed and there is no confirmed completion time.',
 'The access review is closed. The email has not changed and there is no confirmed completion time for the separate request.'
]){
 const r=await replyToSupport({kind:'access',messages:[{role:'operator',content},user('When will access be granted?')],evidence:[]},async()=>{throw Error('Paid model forbidden');});assert.doesNotMatch(r.reply,/operator’s last update/);
}
console.log('PASS source-bound operator access-review timing follow-up and role/topic/resolution boundaries.');
