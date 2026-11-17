import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content});
for(const kind of ['account','access']){
 for(const q of ['How does the bot know an owner wants to sell their house?','How does the AI know they are selling their home?']){
  const r=await replyToSupport({kind,allowAI:false,messages:[{role:'operator',content:'The earlier account issue remains unresolved.'},u(q)]});assert.match(r.reply,/does not know.*wants? to sell/i);assert.match(r.reply,/seller.*response/i);assert.equal(r.status,'open');
 }
 for(const q of ['How does the bot know the repair estimate?','How do I sell my house?','How does the bot know an owner wants to sell? My account is not calling.']){
  const r=await replyToSupport({kind,allowAI:false,messages:[u(q)]});assert.doesNotMatch(r.reply,/does not know.*wants? to sell/i);
 }
 const r=await replyToSupport({kind,allowAI:false,messages:[u('How does the bot know an owner wants to sell?'),u('Where are the contracts?')]});assert.doesNotMatch(r.reply,/does not know.*wants? to sell/i);
}
console.log('PASS fictional seller-intent uncertainty and topic/fault boundaries');
