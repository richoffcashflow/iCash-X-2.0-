import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const deny=async()=>{calls++;throw Error('No model calls');};
const initial=u('I want to know if I can stop old iCash X 1.0 billing. It is still trying to charge me, although I now use 2.0.');
const operator=o('Old 1.0 billing remains an unresolved billing review. Retirement does not prove automatic recharge stopped. What date, amount and merchant description appear?');
const details=u('The notice lists a declined charge attempt for $23.61 dated 08/06.');
const linked=u('This payment is linked to my 1.0 account, not the current platform.');
for(const kind of ['account','access'])for(const handedOff of [false,true])for(const messages of [[initial],[initial,operator,details],[initial,operator,details,linked]]){
 const r=await replyToSupport({kind,handedOff,messages},deny);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);assert.match(r.reply,/retirement does not establish/i);assert.doesNotMatch(r.reply,/What date|two calendar months|charges.*do not apply|Since you signed up|have been stopped/);
 assert.match(r.reply,/any statement details already supplied/i);
}
assert.equal(calls,0);console.log('PASS 12 end-to-end replyToSupport fictional billing continuation cases; no model calls');
