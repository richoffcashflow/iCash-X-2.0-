import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const noModel=async()=>{throw Error('External model forbidden');};
const reply=messages=>replyToSupport({kind:'account',messages,allowAI:false},noModel);
for(const q of ['After the bot finds a contact, how should I contact the owner?','How can I contact a seller myself?','How do I contact the seller after finding their number?']){
 const r=await reply([user(q)]);
 assert.match(r.reply,/Take over/);assert.match(r.reply,/Call or Texts/);assert.match(r.reply,/Return to bot/);
 assert.doesNotMatch(r.reply,/looks up and checks contact details/);
 const changed=await reply([user(q),{role:'assistant',content:r.reply},user('Where is the course?')]);
 assert.doesNotMatch(changed.reply,/Take over/);
}
for(const q of ['How long until the bot finds a contact?','I cannot contact the seller because the phone number is missing.','How should I contact support?','How can I contact buyers?']){
 const r=await reply([user(q)]);assert.doesNotMatch(r.reply,/Take over, then Call or Texts/);
}
console.log('PASS manual seller contact: existing details, timing, missing-number and topic boundaries');
