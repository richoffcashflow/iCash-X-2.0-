import assert from 'node:assert/strict';
import {supportProductConflict} from '../lib/support-product-conflicts.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportQualityReport} from '../lib/support-quality.ts';
const contradictions=[
 'iCash X 2.0 does not use Deal Machine automatically. You need separate software.',
 'The bot only uses credits when reaching out to sellers.',
 'The assignment fee is included in the seller purchase agreement.',
 'The assignment fee is shown in the purchase agreement.',
 'The AI does not automatically make calls. You need to call the sellers yourself.',
 'The cash offer is considered final. You cannot adjust it.',
 'You must manually submit the contracts to title outside the system.',
];
for(const reply of contradictions)assert(supportProductConflict(reply),reply);
for(const reply of [
 'The bot contacts buyers by SMS and email. It does not make outbound calls to buyers.',
 'There are no outbound AI calls to buyers.',
 'Your bot cannot call because no usable number is available.',
 'The AI cannot call right now because it is paused.',
 'Research, calls and texts use work credits.',
 'The assignment fee is not included in the seller purchase agreement.',
 'A signed purchase agreement cannot be silently changed.',
])assert.equal(supportProductConflict(reply),false,reply);
const saved={...process.env};
Object.assign(process.env,{ICASH_SUPPORT_AI_ENABLED:'true',OPENAI_API_KEY:'offline-fixture',ICASH_SUPPORT_AI_MODEL:'fixture'});
try{
 for(const reply of contradictions){
  const result=await replyToSupport({kind:'account',messages:[{role:'user',content:'Explain more about the platform capabilities.'}]},async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,answered:true})}}]}));
  assert.equal(result.ai,false);assert.notEqual(result.reply,reply);assert.notEqual(result.status,'resolved');
 }
}finally{process.env=saved;}
const pairs=[
 ['What company do I say I’m coming from when talking to leads?','You don’t need to add listings or upload properties.'],
 ['How do I obtain a purchase agreement from the buyer?','Choose Take over, then Seller is ready for an agreement.'],
 ['Can you check it please','I don’t have a confirmed answer. What are you trying to do?'],
 ['What is the 10 dollars for','I don’t have a confirmed answer. What are you trying to do?'],
 ...contradictions.map(reply=>['Tell me about iCash X.',reply]),
];
const now=new Date('2026-11-03T01:00:00Z');
const cases=pairs.map(([question,reply],i)=>({id:String(i),kind:'account',subject:'Support',status:'open',updated_at:now.toISOString(),messages:[{role:'user',content:question,created_at:'2026-11-03T00:00:00Z'},{role:'assistant',content:reply,created_at:'2026-11-03T00:01:00Z'}]}));
const report=supportQualityReport(cases,now);
assert.equal(report.flagged,pairs.length);
assert(report.cases.every(c=>c.flags.some(f=>f.code==='mismatch')));
console.log('PASS support product contradictions: rejected model guesses, buyer/seller distinctions, honest failures and observed quality signals. Offline only.');
