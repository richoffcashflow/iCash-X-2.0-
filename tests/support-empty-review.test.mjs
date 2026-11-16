import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const noAI=async()=>{calls++;throw Error('No model calls allowed');};
try{
 for(const kind of ['account','access']){
  const h=[u('Review next step opens an empty screen.')];
  let r=await replyToSupport({kind,messages:h},noAI);assert.match(r.reply,/blocked workflow/);assert.notEqual(r.status,'resolved');assert.doesNotMatch(r.reply,/Notifications tab|call or text the seller/);
  h.push(a(r.reply),u('There is nothing there.'));r=await replyToSupport({kind,messages:h},noAI);assert.match(r.reply,/do not need to repeat/);assert.notEqual(r.status,'resolved');
  const incidence=await replyToSupport({kind,handedOff:true,messages:[u('My research is stuck.'),{role:'operator',content:'The missing research remains unresolved.'},u('Am I the only customer experiencing this?')]},noAI);assert.match(incidence.reply,/verified count/);assert.notEqual(incidence.status,'resolved');
  for(const topic of ['Where is the course?','Cancel my subscription','My payment failed','The seller has not replied'])assert.doesNotMatch(supportConversationFallback({kind,messages:[...h,u(topic)]}).reply,/blocked workflow|verified count/);
  for(const text of ['The Review next step screen works now.','I do not have an empty Review next step screen.','What if Review next step were empty?','My friend says Review next step is empty.','Am I the only owner of this property?'])assert.doesNotMatch(supportConversationFallback({kind,messages:[u(text)]}).reply,/do not need to repeat|verified count/);
  const resolved=[u('Review next step is empty.'),{role:'operator',content:'The customer confirmed the screen now shows the requested details.'},u('There is nothing there.')];assert.doesNotMatch(supportConversationFallback({kind,messages:resolved}).reply,/blocked workflow/);
 }
 assert.equal(calls,0);
}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
console.log('Empty review and incidence boundaries passed');
