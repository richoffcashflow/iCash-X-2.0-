import assert from 'node:assert/strict';
import {supportLocationGuidance,supportLocationParts} from '../lib/support-location-guidance.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const assistant=content=>({role:'assistant',content});
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline';process.env.ICASH_SUPPORT_AI_MODEL='offline';let requests=0;
const model=async()=>{requests++;throw Error('Offline only');};
try{
 for(const kind of ['account','access'])for(const q of ['Why are all my leads coming out of Florida?','Why am I not getting leads in major cities?','Get leads in Ohio','That does not answer why I am not getting leads from anywhere else']){
  const r=await replyToSupport({kind,messages:[user(q)]},model);assert.match(r.reply,/markets automatically/);assert.match(r.reply,/no.*state.*selector/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/upload|call attempts|texts sent|changed your market/);
 }
 for(const q of ['Where do leads come from?','Why are leads off the market?','What company am I coming from when talking to leads?','Upload leads in Ohio','Refund my payment for leads','Where are my seller phone numbers?','My bot is not calling leads','Find buyer leads in Florida','Cancel my lead subscription','I cannot sign in','How do I send a contract?'])assert.equal(supportLocationGuidance({kind:'account',messages:[user('Get leads in Ohio'),user(q)]}),null,q);
 for(const turn of [user('Where is the course?'),{role:'operator',content:'The remaining issue is call playback.'},user('That worked')])assert.equal(supportLocationGuidance({kind:'account',messages:[user('Get leads in Ohio'),turn,user('It still does not work')]}),null);
 for(const kind of ['account','access']){
  const messages=[user('Hi, can I set what state I want?')];
  const ask=()=>replyToSupport({kind,messages},model);
  const state=await ask();
  assert.match(state.reply,/state/);
  messages.push(assistant(state.reply),user('Is there another workspace?'));
  const workspace=await ask();
  assert.match(workspace.reply,/markets automatically/);
  assert.match(workspace.reply,/which other workspaces/i);
  assert.equal(workspace.status,'open');
  // An old unsupported assistant assertion is never evidence of eligibility.
  messages.push(assistant('You can only have one workspace.'),user('Could I sign up for a different one?'));
  const signup=await ask();
  assert.match(signup.reply,/sign up again.*choose a market/i);
  assert.match(signup.reply,/can’t confirm.*second workspace/i);
  assert.equal(signup.status,'open');
  assert.equal(signup.ai,false);
  const direct=await replyToSupport({kind,messages:[user('Could I open another workspace to target a different state?')]},model);
  assert.equal(direct.reply,signup.reply);
  for(const boundary of [user('Where is the course?'),{role:'operator',content:'Your purchase access was verified.'},user('That worked.')]){
   assert.equal(supportLocationParts({kind,messages:[...messages.slice(0,-1),boundary,assistant('Okay.'),user('Can I sign up for a different one?')]}),null);
  }
  for(const unrelated of ['Can I sign up for a different course?', 'How do I cancel my workspace?', 'Can I sign up for a different one? I was charged twice.']){
   assert.equal(supportLocationParts({kind,messages:[...messages.slice(0,-1),user(unrelated)]}),null);
  }
  assert.equal(supportLocationParts({kind,messages:[user('Could I sign up for a different one?')]}),null);
 }
 assert.equal(requests,0);
}finally{process.env=env;}
console.log('PASS location guidance offline');
