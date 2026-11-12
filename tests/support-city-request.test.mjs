import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportLocationGuidance} from '../lib/support-location-guidance.ts';
const u=content=>({role:'user',content});
const ask=(messages,kind='account')=>replyToSupport({kind,messages,handedOff:true,allowAI:false},async()=>{throw Error('Paid calls forbidden');});
for(const kind of ['account','access']){
 for(const q of ['I want you to only focus on cities like Phoenix and Seattle.', 'Please focus on markets like Portland.', 'Focus my bot only on states like Ohio.']){
  const r=await ask([u('Why are my leads concentrated in one area?'),{role:'operator',content:'The concentration is still under review; no market restriction was applied.'},u(q)],kind);
  assert.match(r.reply,/no city, state or ZIP-code selector/);assert.match(r.reply,/has not changed/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/now focus|updated your|will only search/i);
 }
}
for(const q of ['Please focus on the course.', 'Do not focus my bot on Ohio.', 'The seller wants to focus on cities like Portland.', 'I want a refund for leads in these cities.'])assert.equal(supportLocationGuidance({kind:'account',messages:[u(q)]}),null);
assert.doesNotMatch((await ask([u('Please focus on markets like Portland.'),u('Where is the course?')])).reply,/city, state or ZIP-code selector/);
console.log('PASS fictional explicit city requests, guest, operator, negation and topic boundaries; no paid calls');
