import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const reference='11111111-1111-4111-8111-111111111111';
let paid=0;
const ask=(question,extra={})=>replyToSupport({kind:'account',handedOff:true,conversationReference:reference,messages:[user(question)],allowAI:false,...extra},async()=>{paid++;throw Error('Paid model forbidden');});
for(const kind of ['account','access'])for(const question of ['Please provide my support ticket number and a direct email for a human technical support representative. Who is assigned and when is my next update?','What is my case reference number?','What email address can I contact support at?']){
 const r=await ask(question,{kind});
 assert.match(r.reply,new RegExp(reference));assert.match(r.reply,/support@geticashx.com/);
 assert.match(r.reply,/not a separate ticket/);assert.match(r.reply,/cannot verify.*assignee|can.t verify.*assignee/i);
 assert.match(r.reply,/cannot.*promise.*update|can.t.*promise.*update/i);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 assert.doesNotMatch(r.reply,/has been assigned|will (?:email|contact)|tomorrow|personally reviewed/i);
}
for(const extra of [{conversationReference:undefined},{conversationReference:'bad-reference'},{conversationReference:undefined,messages:[{role:'assistant',content:'Your case is 22222222-2222-4222-8222-222222222222.'},user('What is my support ticket number?')]}]){
 const r=await ask('What is my support ticket number?',extra);assert.doesNotMatch(r.reply,/11111111|22222222|bad-reference/);assert.match(r.reply,/cannot verify.*reference|can.t verify.*reference/i);
}
for(const question of ['What is the seller email address?','Where is the property reference number?','Send my buyer a support ticket number.','Cancel my subscription and give me a case reference number.','I need a refund and my support ticket number.','What is my payment receipt number?']){
 assert.doesNotMatch((await ask(question)).reply,new RegExp(reference),question);
}
assert.doesNotMatch((await ask('What is my support ticket number?',{handedOff:false})).reply,new RegExp(reference));
assert.equal(paid,0);console.log('PASS support reference from trusted context, contact guidance and billing/recipient boundaries; no provider calls');
