import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const noModel=async()=>{throw Error('Paid model forbidden');};
const reply=(kind,q,history=[])=>replyToSupport({kind,messages:[...history,user(q)],allowAI:false,handedOff:true},noModel);
for(const kind of ['account','access']){
 for(const q of ['If I take over a property, can the owner see my personal phone number?','Will texting a seller myself show my own number?','When I use Call in the app, will my personal number appear?']){
  const r=await reply(kind,q);assert.match(r.reply,/business number/);assert.match(r.reply,/Take over alone does not/);assert.match(r.reply,/outside iCash X/);assert.equal(r.status,'open');assert.equal(r.ai,false);
 }
 const q='Could the text be failing because the seller has a landline?';
 const r=await reply(kind,q);assert.match(r.reply,/does not establish why/);assert.match(r.reply,/property.*error|error.*property/i);assert.doesNotMatch(r.reply,/why new outreach hasn’t started|recorded call attempts|landline.*is the cause/i);assert.equal(r.status,'open');
 for(const next of ['Where is the course?','Cancel my subscription','I was charged twice','How do I change my personal phone number?','The seller already saw my personal number; investigate that.']){
  const changed=await reply(kind,next,[user(q),{role:'assistant',content:r.reply},{role:'operator',content:'The delivery problem is unresolved.'}]);
  assert.doesNotMatch(changed.reply,/Take over alone does not|landline label/);
 }
 const topic=await reply(kind,'Will texting a seller myself show my own number?',[user('The bot has not called anyone.'),{role:'operator',content:'The activity problem is still unresolved.'}]);
 assert.match(topic.reply,/business number/);assert.equal(topic.status,'open');assert.doesNotMatch(topic.reply,/fixed|restored|has resumed/);
 const other=await reply(kind,'If I take over, will the bot find a buyer?');assert.doesNotMatch(other.reply,/personal number|landline label/);
}
console.log('PASS contact privacy and landline questions: account/guest, billing, reported exposure, operator and topic boundaries; no providers');
