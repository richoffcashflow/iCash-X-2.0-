import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}), assistant=content=>({role:'assistant',content});
const ask=(kind,messages)=>replyToSupport({kind,messages,allowAI:false},async()=>{throw Error('External model forbidden');});
for(const kind of ['account','access']){
 for(const q of ['What happens when my work credits run out?', 'If my credits run out before a seller answers, will the bot still contact them?', 'Will it keep texting existing sellers when I have no credits left?']){
  const r=await ask(kind,[user(q)]);assert.match(r.reply,/new paid work/i);assert.match(r.reply,/already.*conversation/i);assert.match(r.reply,/already.*(?:started|admitted)/i);assert.notEqual(r.status,'resolved');
 }
 const history=[user('What happens when my credits run out?'),assistant('New paid work needs available work credits.')];
 const follow=await ask(kind,[...history,user('So will my bot still contact them?')]);assert.match(follow.reply,/new paid work/i);
 for(const q of ['How do I cancel my subscription?','Where is the course?','The seller ran out of time. What do credits pay for?','My credits will not run out. How do I edit an agreement?','My credit purchase is missing.','How much do credits cost?','My seller replied and the problem is fixed now.']){
  const r=await ask(kind,[...history,user(q)]);assert.doesNotMatch(r.reply,/already.*conversation/i);
 }
 const operator=await ask(kind,[...history,{role:'operator',content:'The seller requested no more messages.'},user('So will my bot still contact them?')]);assert.doesNotMatch(operator.reply,/already.*conversation/i);
 const changed=await ask(kind,[...history,user('How do I edit an agreement?'),assistant('Open Agreements.'),user('So will my bot still contact them?')]);assert.doesNotMatch(changed.reply,/already.*conversation/i);
}
console.log('PASS exhausted credit guidance, existing-seller follow-up and topic/operator boundaries; offline only');
