import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const ask=(messages,extra={})=>replyToSupport({kind:'access',messages,handedOff:true,allowAI:false,...extra},async()=>{throw Error('Paid model forbidden');});
for(const kind of ['access','account']){
 const q='I used the wrong checkout email and was charged twice. Is there a phone number to reach support?';
 const r=await ask([u(q)],{kind});assert.match(r.reply,/duplicate-charge/);assert.match(r.reply,/ownership.*check|ownership.*verified/i);assert.match(r.reply,/conversation/);assert.match(r.reply,/can.t promise.*phone/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 const repeat=await ask([u(q),a(r.reply),u(q)],{kind});assert.match(repeat.reply,/payment review needs the dates and amounts/i);assert.doesNotMatch(repeat.reply,/What dates and amounts/);assert.match(repeat.reply,/has not changed.*email|has not changed it/i);
}
for(const q of ['The seller has the wrong email and says they were charged twice.','My checkout email is correct. I was charged twice.','Where is the course?','How do I change my Settings email?','I used the wrong checkout email and was charged twice.','The wrong checkout email was corrected. I was charged twice.']){
 const r=await ask([u('My checkout email was wrong and I was charged twice.'),{role:'operator',content:'The email correction was completed; the separate payment review is still open.'},u(q)]);
 assert.doesNotMatch(r.reply,/wrong checkout email also needs/);
}
const renewed=await ask([{role:'operator',content:'The email correction was completed.'},u('The checkout email is still wrong, and I was charged twice.')]);assert.match(renewed.reply,/ownership.*check/);
const pending=await ask([{role:'operator',content:'The email correction is not completed; ownership needs verification.'},u('I used the wrong checkout email and was charged twice.')]);assert.match(pending.reply,/ownership.*check/);
console.log('PASS mixed purchase email, duplicate-charge and contact guidance boundaries');
