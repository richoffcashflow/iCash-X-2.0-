import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const deny=async()=>{calls++;throw Error('No model calls');};
const initial=u('Hi, I wanted to know if I could disable my usage activity for the iCash X 1.0 version. I have not manually called or messaged anyone in a month, but the software is still attempting to charge me. After signing up to 2.0 I can no longer access 1.0.');
const operator=o('Old 1.0 billing remains an unresolved billing review. Retirement does not prove automatic recharge stopped. What date, amount and merchant description appear?');
const details=u('My email shows a charge attempt on 11/14 for $14.37 from ICash X that was declined.');
const linked=u('It is not linked to my current iCash X 2.0 account but it is linked to my 1.0 account.');
for(const kind of ['account','access'])for(const handedOff of [false,true])for(const messages of [[initial],[initial,operator,details],[initial,operator,details,linked]]){
 const r=await replyToSupport({kind,handedOff,messages},deny);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);assert.match(r.reply,/retirement does not establish/i);assert.doesNotMatch(r.reply,/What date|two calendar months|charges.*do not apply|Since you signed up|have been stopped/);
 assert.match(r.reply,/any statement details already supplied/i);
}
assert.equal(calls,0);console.log('PASS 12 end-to-end replyToSupport anonymous actual-shaped cases; no model calls');
