import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}), assistant=content=>({role:'assistant',content});
const ask=messages=>replyToSupport({kind:'account',messages,allowAI:false},async()=>{throw Error('External model forbidden');});
for(const q of ['The AI is on but it is not doing anything.','My AI is running but it isn’t doing anything.','The bot is on but it has not been doing anything.']){
 const r=await ask([user(q)]);assert.equal(r.managementReview,true);assert.match(r.reply,/missing or slow activity/);assert.notEqual(r.status,'resolved');
}
const history=[user('My AI is on but it is not doing anything.'),assistant('Is your bot set to Run or Paused?')];
for(const q of ['It is running; the green light is on.',"It’s running it has the green light on"]){const r=await ask([...history,user(q)]);assert.equal(r.managementReview,true);assert.match(r.reply,/missing or slow activity/);}
for(const q of ['Where is the course?','How do I cancel my subscription?','My AI is running well now.']){
 const r=await ask([...history,user(q)]);assert.doesNotMatch(r.reply,/lack of progress is frustrating/);
}
const unrelated=await ask([user('Where is the course?'),assistant('Is the video running?'),user('The green light is on.')]);assert.doesNotMatch(unrelated.reply,/lack of progress is frustrating/);
console.log('PASS running activity continuity and topic boundaries; offline only');
