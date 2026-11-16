import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {currentAccessConversation} from '../lib/support-access-topic.ts';
import {supportCodeDelivery} from '../lib/support-code-delivery.ts';
const user=content=>({role:'user',content});
const assistant=content=>({role:'assistant',content});
for(const kind of ['account','access']){
 for(const opening of ['The email I used to purchase is not sending any codes.','No verification codes have arrived.']){
  const messages=[user(opening),assistant('Your missing code remains unresolved.'),user('Why am I unable to sign in?'),assistant('Access remains unresolved.'),user('Where is my code?')];
  const r=await replyToSupport({kind,messages,allowAI:false});
  assert.equal(supportCodeDelivery(currentAccessConversation(messages)),'missing');
  assert.doesNotMatch(r.reply,/enter the newest code|after.*code is accepted|private Safari/i);
  assert.notEqual(r.status,'resolved');
 }
 for(const topic of ['How do I cancel my subscription?','How do I change the bot voice?','What are work credits?']){
  const messages=[user('No verification codes have arrived.'),assistant('Access remains unresolved.'),user(topic)];
  assert.equal(currentAccessConversation(messages).length,0);
  const r=await replyToSupport({kind,messages,allowAI:false});
  assert.doesNotMatch(r.reply,/receipt email match|main button say|request one fresh code/i);
 }
 for(const confirmation of ['I received the code now, but it is invalid.','I received the codes now.','The codes arrived.']){
  const received=[user('No verification codes have arrived.'),assistant('Access remains unresolved.'),user(confirmation)];
  assert.equal(supportCodeDelivery(currentAccessConversation(received)),'received');
 }
 assert.equal(currentAccessConversation([user('No verification codes have arrived.'),user('I got in!')]).length,0);
 const operator=[user('No verification codes have arrived.'),{role:'operator',content:'The checkout email differs from the payment receipt. Ownership still needs verification.'},user('Where is my code?')];
 const r=await replyToSupport({kind,messages:operator,allowAI:false});
 assert.match(r.reply,/payment check already recorded/i);assert.notEqual(r.status,'resolved');
}
for(const question of ['Where are the promo codes?','How do I use coupon codes?','Where can I find source codes?','Which ZIP codes does the bot use?'])assert.equal(currentAccessConversation([user(question)]).length,0);
console.log('PASS plural missing-code context, received codes, operator and topic boundaries');
