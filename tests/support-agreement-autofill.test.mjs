import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportInboxGuidance} from '../lib/support-inbox-guidance.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const history=[user('Can saved seller details fill my purchase agreement?'),assistant('Supported details can fill empty fields; review them before signing.')];
const original={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let modelCalls=0;
const noModel=async()=>{modelCalls++;throw Error('No paid model calls in regression replays');};
try{
 for(const kind of ['account','access']){
  for(const question of ['Does the bot autofill these forms?','So my bot will not auto-fill the forms?','Can these forms fill automatically?','Can the bot automatically fill the form?']){
   const result=await replyToSupport({kind,contactKnown:true,messages:[...history,user(question)]},noModel);
   assert.match(result.reply,/fill empty fields/,question);
   assert.match(result.reply,/keeping your edits/);
   assert.match(result.reply,/Fill from saved conversations/);
   assert.match(result.reply,/Review the names, price and date/);
   assert.match(result.reply,/does not confirm.*prepared or sent/);
   assert.equal(result.status,'open');assert.equal(result.ai,false);
  }
  const explicit=await replyToSupport({kind,messages:[user('Can the bot auto fill the purchase agreement forms?')]},noModel);
  assert.match(explicit.reply,/fill empty fields/);
  const repeated=await replyToSupport({kind,messages:[...history,user('Does it autofill the forms?'),assistant(explicit.reply),user('Can these forms fill automatically?')]},noModel);
  assert.match(repeated.reply,/fill empty fields/);assert.equal(repeated.status,'open');
  for(const question of ['Can it autofill the checkout form?','Can it autofill tax forms?','Will my browser autofill the sign-in form?','Can it auto fill my payment form?','Can it autofill the registration form?','How do I change my voice?']){
   assert.doesNotMatch(supportInboxGuidance({kind,messages:[...history,user(question)]})?.reply??'',/fill empty fields/,question);
  }
  for(const boundary of [
   [user('Can the bot autofill these forms?')],
   [...history,{role:'operator',content:'This agreement has conflicting seller details and needs review.'},user('Can the bot autofill these forms?')],
   [...history,user('How do I change my voice?'),assistant('Open the voice panel.'),user('Can the bot autofill these forms?')],
   [...history,user('That worked.'),assistant('Glad it worked.'),user('Can the bot autofill these forms?')],
  ]){
   assert.doesNotMatch(supportInboxGuidance({kind,messages:boundary})?.reply??'',/fill empty fields/);
   const result=await replyToSupport({kind,allowAI:false,messages:boundary},noModel);
   assert.doesNotMatch(result.reply,/fill empty fields/);
  }
  const fault=await replyToSupport({kind,messages:[user('The purchase agreement is blank and auto fill is not working')]},noModel);
  assert.match(fault.reply,/problem is still unresolved/);assert.equal(fault.status,'open');
 }
 assert.equal(modelCalls,0);
}finally{process.env=original;}
console.log('Agreement autofill support: account/guest plural follow-ups, unrelated forms, operator/topic/success boundaries and unresolved failures passed. No provider calls.');
