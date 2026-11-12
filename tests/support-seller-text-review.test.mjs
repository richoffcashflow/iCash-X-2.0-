import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportCurrentStepReply} from '../lib/support-current-step.ts';
const user=content=>({role:'user',content}), assistant=content=>({role:'assistant',content});
const check=messages=>supportCurrentStepReply({kind:'account',messages});
for(const text of ['The bot has not texted the seller back.', 'The seller said please text me but the bot never sent a reply.', 'Why does it say checking text availability?']){
 const result=check([user(text)]);assert(result,'specific missing seller text needs its own reply');assert.equal(result.status,'open');
 assert.match(result.reply,/specific property|which property/i);assert.doesNotMatch(result.reply,/save resolution|try calling|credit hold|has sent|will send/i);
 for(const next of ['Please','Help check what is happening next','The bot never sent a reply','Is that why there is no automatic response?']){
  const r=check([user(text),assistant(result.reply),user(next)]);assert(r);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/save resolution|try calling|credit hold|has sent|will send/i);
 }
 for(const next of ['Where is the course?','Cancel my subscription','My sign-in code is missing','How do I text a seller myself?','That worked']){
  const r=check([user(text),assistant(result.reply),user(next)]);assert(!r||!/specific property|text composer|missing automatic reply/i.test(r.reply),next);
 }
 assert.equal(check([user(text),{role:'operator',content:'We are reviewing the saved message receipt.'},user('Please')]),null);
}
assert.equal(supportCurrentStepReply({kind:'access',messages:[user('The bot has not texted the seller back.')]}),null);
console.log('PASS seller text review: specific failure, short follow-up, availability uncertainty and topic/operator boundaries.');

for(const q of ['The bot has not texted the seller back.','Why does it say checking text availability?']){
 const result=await replyToSupport({kind:'account',messages:[user(q)],evidence:[]},async()=>{throw Error('No external model');});
 assert.match(result.reply,/missing automatic reply is still unresolved|text composer/);assert.equal(result.status,'open');
}

const availabilityOnly=check([user('Why does it say checking text availability?')]);
assert.doesNotMatch(availabilityOnly.reply,/missing automatic reply is still unresolved/);
for(const q of ['The bot has not sent the buyer a reply.','The bot has not sent the contract.','The bot is not sending a sign-in code.']){
 const r=check([user(q)]);assert(!r||!/specific property|text composer|missing automatic reply/i.test(r.reply));
}
assert.equal(check([assistant('The bot has not texted the seller back.'),user('Please')]),null);
const combined=check([user('The bot has not texted the seller back.'),assistant('We need to check.'),user('Why does it say checking text availability?')]);
assert.match(combined.reply,/still unresolved/);assert.match(combined.reply,/does not establish/);

const propertyFollowup=await replyToSupport({kind:'account',messages:[user('The bot has not texted the seller back.'),assistant('Which property is affected?'),user('123 Example Lane')],evidence:[]},async()=>{throw Error('No external model');});
assert.match(propertyFollowup.reply,/property details you shared/);assert.doesNotMatch(propertyFollowup.reply,/Which property|has sent|will send/i);assert.equal(propertyFollowup.status,'open');

const addressTopicChange=check([user('The bot has not texted the seller back.'),assistant('Which property is affected?'),user('123 Example Lane is unrelated. Where is the course?')]);
assert(!addressTopicChange||!/property details you shared|missing automatic reply/i.test(addressTopicChange.reply));

// Fictional recurrence: short failure reports must retain the seller-text issue.
const missingHistory=[user('The bot has not texted the seller back.'),assistant('Which property is affected?')];
const availabilityHistory=[user('Why does it say checking text availability?'),assistant('That is the composer check.')];
for(const history of [missingHistory,availabilityHistory])for(const q of ['It still has not messaged the seller.','Still hasn’t messaged that seller.','It did not respond to the seller.']){
 for(const handedOff of [false,true]){
  const r=await replyToSupport({kind:'account',messages:[...history,user(q)],handedOff,evidence:[],allowAI:false},async()=>{throw Error('No external model');});
  assert.match(r.reply,/missing automatic reply is still unresolved/i,q);assert.equal(r.status,'open');
  assert.doesNotMatch(r.reply,/recorded call attempts|texts.*delivered|will send|fixed/i);
 }
}
assert.match(check([user('The bot has not messaged the seller back.')]).reply,/missing automatic reply/i);
for(const q of ['I still have not messaged the seller.','It still has not messaged the buyer.','It still has not sent the contract.']){
 const r=check([...missingHistory,user(q)]);assert(!r||!/missing automatic reply/i.test(r.reply),q);
}
for(const boundary of [user('Where is the course?'),user('It worked'),{role:'operator',content:'The saved seller receipt needs separate review.'}]){
 const r=check([...missingHistory,boundary,user('It still has not messaged the seller.')]);assert(!r||!/missing automatic reply/i.test(r.reply));
}
assert.equal(check([user('It still has not messaged the seller.')]),null);
assert.equal(supportCurrentStepReply({kind:'access',messages:[...missingHistory,user('It still has not messaged the seller.')]}),null);
