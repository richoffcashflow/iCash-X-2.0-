import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const history=[u('Can I add an outside property to my leads?'),a('Customer accounts cannot import their own properties.')];
const saved={...process.env};Object.assign(process.env,{ICASH_SUPPORT_AI_ENABLED:'true',OPENAI_API_KEY:'fictional',ICASH_SUPPORT_AI_MODEL:'fictional'});
let calls=0;const forbidden=async()=>{calls++;throw Error('Model forbidden');};
try{
 for(const kind of ['account','access'])for(const handedOff of [false,true]){
  for(const question of ['What if this property is eligible?','What if that house qualifies?','How can I tell the bot about this property?']){
   const r=await replyToSupport({kind,handedOff,messages:[...history,u(question)]},forbidden);
   assert.match(r.reply,/eligibility.*does not guarantee.*find/i);assert.match(r.reply,/cannot.*(?:add|submit|import)/i);assert.doesNotMatch(r.reply,/will add|Add listing|owner demo/);assert.equal(r.status,'open');
  }
  const follow=await replyToSupport({kind,handedOff,messages:[u('How can I add propperty information to my dashboard?'),a('You cannot import it.'),u('What if that house qualifies?'),a('Eligibility does not guarantee discovery.'),u('How do I tell my bot about that property?')]},forbidden);assert.match(follow.reply,/eligibility.*does not guarantee.*find/i);
  for(const topic of ['What if this buyer is eligible?','What if my refund is eligible?','How do I send the purchase agreement?','My payment failed.','This property is not eligible.'])assert.doesNotMatch(supportConversationFallback({kind,messages:[...history,u(topic)]}).reply,/eligibility.*does not guarantee.*find/i);
  for(const boundary of [[u('Can I change my voice?'),a('Custom voice requires the current voice workflow.')],[{role:'operator',content:'The current question concerns a property already in the account.'}]])assert.doesNotMatch(supportConversationFallback({kind,messages:[...history,...boundary,u('What if this property is eligible?')]}).reply,/eligibility.*does not guarantee.*find/i);
  assert.doesNotMatch(supportConversationFallback({kind,messages:[u('What if this property is eligible?')]}).reply,/eligibility.*does not guarantee.*find/i);
 }
 assert.equal(calls,0);
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
console.log('Specific outside-property discovery and topic boundaries passed');
