import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportProductClarification} from '../lib/support-product-clarifications.ts';
const user=content=>({role:'user',content});
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const forbidden=async()=>{calls++;throw Error('Paid model calls forbidden');};
try{
 for(const kind of ['account','access'])for(const q of ['How much does it cost to start the bot?','How much does it cost to start Bot','I thought the monthly fee gave me access to the system to do deals.','I thought $50 a month gave me access to the system to do deals.']){
  for(const handedOff of [false,true]){
   const r=await replyToSupport({kind,messages:[{role:'assistant',content:'Your issue is in management review.'},user(q)],handedOff,evidence:[]},forbidden);
   assert.match(r.reply,/subscription/i);assert.match(r.reply,/separate/i);assert.match(r.reply,/\$0/i);assert.match(r.reply,/Add money/);
   assert.doesNotMatch(r.reply,/Which page|start (?:soon|automatically)|guaranteed (?:deal|lead)|your subscription is active|confirmed fix/i);
   if(handedOff)assert.equal(r.status,'open');
  }
 }
 assert.equal(calls,0);
 for(const q of ['How much does it cost to start a buyer contract?','I paid the monthly fee but my access is locked.','I thought my monthly fee gave access but I cannot sign in.','I thought the monthly fee gave me access; refund it.','How much does it cost to start Bot? I was charged twice.','I thought the monthly fee gave me access but the page is broken.','Cancel my subscription.']){
  const r=supportProductClarification([user(q)]);
  assert.ok(!r||!r.reply.includes('subscription includes $0'),q);
 }
 const changed=await replyToSupport({kind:'account',messages:[user('How much does it cost to start Bot?'),{role:'assistant',content:'Software access and work credits are separate.'},user('Where is the course?')],evidence:[]},forbidden);
 assert.doesNotMatch(changed.reply,/work credits|Add money/i);
}finally{process.env=env;}
console.log('PASS bot startup cost: direct policy, handoff and payment/access/topic boundaries; no model calls.');
