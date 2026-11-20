import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportLocationGuidance} from '../lib/support-location-guidance.ts';
const u=content=>({role:'user',content});
const ask=(content,kind='account',before=[])=>replyToSupport({kind,messages:[...before,u(content)],allowAI:false,handedOff:true},async()=>{throw Error('Paid calls forbidden');});
for(const kind of ['account','access']){
 for(const q of [
  "I am not asking about Riley's voice. That is already working. I want to change the property search settings. Can I choose which states and cities Riley searches for wholesale properties? Can I prioritize Ohio while searching nationwide? Please answer yes or no and tell me where the settings are.",
  'Keep my cloned voice unchanged. Where can I choose states for property searches?',
  'My voice is working. Can I select cities for the bot to search for houses?',
  'Can I choose which states and cities the bot searches for properties?'
 ]){
  const r=await ask(q,kind,[u('The bot stopped researching.'),{role:'operator',content:'The earlier activity claim was unconfirmed; the stopped research remains under review.'}]);
  assert.match(r.reply,/no city, state or ZIP-code selector/i,q);assert.doesNotMatch(r.reply,/record, verify|Play my cloned voice|What are you trying to do/i,q);assert.equal(r.status,'open');
 }
 const mixed=await ask('Can I choose cities for property searches? How do I create my own voice?',kind);
 assert.match(mixed.reply,/no city, state or ZIP-code selector/i);assert.match(mixed.reply,/Choose recording|Uploading your recording/i);
 const joined=await ask('Can I choose cities for property searches and how do I create my own voice?',kind);
 assert.match(joined.reply,/no city, state or ZIP-code selector/i);assert.match(joined.reply,/Choose recording|Uploading your recording/i);
 const fault=await ask('Can I choose cities for property searches? My voice upload failed.',kind);
 assert.match(fault.reply,/no city, state or ZIP-code selector/i);assert.match(fault.reply,/unresolved|exact message|upload/i);
 const payment=await ask('Can I choose cities for property searches? I was charged twice.',kind);
 assert.match(payment.reply,/charge|payment/i);assert.equal(payment.status,'open');
 const changed=await ask('How do I create my own voice?',kind,[u('Can I choose cities for property searches?')]);
 assert.doesNotMatch(changed.reply,/city, state or ZIP-code selector/i);assert.match(changed.reply,/Choose recording|Uploading your recording/i);
}
for(const q of ['Do not choose cities for property searches.','I do not want to change the property search states.','The seller wants to choose cities for property searches.','How do I change my voice?'])assert.equal(supportLocationGuidance({kind:'account',messages:[u(q)]}),null,q);
console.log('PASS fictional property-search, deferred voice, mixed faults and topic-change replies');
