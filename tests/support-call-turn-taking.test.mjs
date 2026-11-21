import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportCallRecordingReply} from '../lib/support-call-recordings.ts';
const u=content=>({role:'user',content});
for(const kind of ['account','access']){
 for(const text of ['The bot is talking to itself during calls.','My AI bot keeps speaking over the seller on a call.', 'The bot is speaking to itself on calls and does not follow the conversation.']){
 const r=await replyToSupport({kind,messages:[{role:'operator',content:'Earlier text delivery remains under review.'},u(text)],handedOff:true,allowAI:false},async()=>{throw Error('Paid model forbidden');});
 assert.match(r.reply,/call.*conversation|conversation.*call/i);assert.match(r.reply,/property and call time/);assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/9 AM|will.*fix|restart/i);
 }
 for(const text of ['The bot is not talking to itself during calls.','What if the bot talks to itself on calls?','Cancel my subscription; the bot is talking to itself on calls.','The seller is talking to himself during a call.','How do I change my city?'])assert.equal(supportCallRecordingReply({kind,messages:[u(text)]}),null,text);
 const r=await replyToSupport({kind,messages:[u('The bot is talking to itself during calls.'),{role:'operator',content:'The call is under review.'},u('How do I change my city?')],allowAI:false});assert.doesNotMatch(r.reply,/call conversation/);
}
console.log('PASS call turn-taking complaints and negative/topic boundaries');
