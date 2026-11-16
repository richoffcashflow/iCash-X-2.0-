import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content});
for(const kind of ['account','access']){
 for(const q of ['What is management review?','What does management review mean?','What is the review?']){
 const r=await replyToSupport({kind,handedOff:true,allowAI:false,messages:[user('My work stopped.'),{role:'operator',content:'Your settings question is answered; the work problem remains unresolved.'},user(q)]});
 assert.match(r.reply,/flagged.*support review queue/i);assert.match(r.reply,/does not mean.*currently working/i);assert.match(r.reply,/reply.*(?:here|conversation)/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 assert.doesNotMatch(r.reply,/will (?:call|reply|start)|within \d|fixed your|human agent here/i);
 }
 for(const q of ['How do I cancel my subscription?','What is a property review?','How do I change my voice?']){
 const r=await replyToSupport({kind,handedOff:true,allowAI:false,messages:[user('What is management review?'),{role:'assistant',content:'Your case is in management review.'},user(q)]});assert.doesNotMatch(r.reply,/flagged.*support review queue/i);
 }
 const r=await replyToSupport({kind,handedOff:false,allowAI:false,messages:[{role:'assistant',content:'You are in management review.'},user('What is management review?')]});assert.doesNotMatch(r.reply,/your (?:case|conversation) is flagged/i);
}
console.log('PASS management-review definition and topic/queue boundaries');
