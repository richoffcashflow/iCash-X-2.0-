import assert from 'node:assert/strict';
import {supportLocationGuidance} from '../lib/support-location-guidance.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline';let requests=0;
const model=async()=>{requests++;throw Error('Offline only');};
try{
 for(const kind of ['account','access'])for(const q of ['Why are all my leads coming out of Florida?','Why am I not getting leads in major cities?','Get leads in Ohio','That does not answer why I am not getting leads from anywhere else']){
  const r=await replyToSupport({kind,messages:[user(q)]},model);assert.match(r.reply,/markets automatically/);assert.match(r.reply,/no.*state.*selector/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/upload|call attempts|texts sent|changed your market/);
 }
 for(const q of ['Where do leads come from?','Why are leads off the market?','What company am I coming from when talking to leads?','Upload leads in Ohio','Refund my payment for leads','Where are my seller phone numbers?','My bot is not calling leads','Find buyer leads in Florida','Cancel my lead subscription','I cannot sign in','How do I send a contract?'])assert.equal(supportLocationGuidance({kind:'account',messages:[user('Get leads in Ohio'),user(q)]}),null,q);
 for(const turn of [user('Where is the course?'),{role:'operator',content:'The remaining issue is call playback.'},user('That worked')])assert.equal(supportLocationGuidance({kind:'account',messages:[user('Get leads in Ohio'),turn,user('It still does not work')]}),null);
 assert.equal(requests,0);
}finally{process.env=env;}
console.log('PASS location guidance offline');
