import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportPurchaseHelp} from '../lib/support-purchase-help.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const prior=[user('I paid but no sign-in code arrived.'),assistant('Does the receipt email match?')];
for(const kind of ['access','account'])for(const q of ['No, I misspelled my email by one letter.','I mis-spelt my checkout email.','I cannot receive my login code because I misspelled my email. Can I use my phone?']){
 const r=await replyToSupport({kind,messages:[...prior,user(q)],evidence:[]},async()=>{throw Error('No paid model calls');});
 assert.match(r.reply,/ownership.{0,20}verif|purchase-ownership/,'wrong checkout email must reach ownership review');
 assert.doesNotMatch(r.reply,/request one fresh code|check that inbox|has been corrected|access restored/i);
 assert.notEqual(r.status,'resolved');assert.notEqual(r.status,'closed');
}
for(const q of ['The seller misspelled their email.','The buyer email has a typo.','Update the bot contact email in settings.','Cancel my subscription','My code still has not arrived'])assert.equal(supportPurchaseHelp([...prior,user(q)]),null,q);
const changed=await replyToSupport({kind:'access',messages:[...prior,user('I misspelled my email.'),assistant('Ownership verification is needed.'),user('That worked, I am in now.')],evidence:[]},async()=>{throw Error('No paid model calls');});
assert.equal(changed.status,'resolved');
console.log('PASS checkout email: wrong-email review outranks repeated code steps; account/guest, phone, topic and success boundaries.');
for(const kind of ['account','access'])for(const q of [
 'I never received a confirmation because I misspelled my email I contacted support with proof of purchase but never heard back.',
 'I typed the wrong purchase email. I already emailed my receipt but nobody replied.',
 'I misspelled my email and contacted support by email with purchase proof, but never received a response.',
]){
 const r=await replyToSupport({kind,messages:[user(q)],evidence:[]},async()=>{throw Error('No paid model calls');});
 assert.match(r.reply,/do not need to (?:re)?send|don’t (?:re)?send/i);
 assert.doesNotMatch(r.reply,/Email your merchant receipt|ownership (?:is|was) verified|email (?:has been|was) changed/i);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);
}
for(const q of ['I used the wrong checkout email. I have not emailed my receipt.','I used the wrong checkout email. I never sent proof.','I used the wrong checkout email. I plan to email the receipt.'])assert.doesNotMatch(supportPurchaseHelp([user(q)]).reply,/already sent the purchase proof/i);
for(const q of ['The seller misspelled their email and sent proof.','How do I call a seller?','Cancel my subscription.'])assert.equal(supportPurchaseHelp([user('I typed the wrong checkout email and emailed proof.'),user(q)]),null);
