// Anonymous inbox wording; all responses and transport are exercised offline.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportProductClarification} from '../lib/support-product-clarifications.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const noAI=async()=>{calls++;throw Error('Known inbox answers must not depend on AI');};
try{
 for(const kind of ['account','access']){
  for(const question of ['If a seller does not text back, does the conversation stay blank?','Will the text conversation be empty if the owner has not replied?']){
   const answer=await replyToSupport({kind,messages:[user(question)]},noAI);
   assert.match(answer.reply,/saved outgoing texts/);assert.match(answer.reply,/does not prove delivery/);assert.notEqual(answer.status,'resolved');
   assert.doesNotMatch(answer.reply,/recorded call attempts|new outreach hasn/);
  }
  const unansweredHistory=[{role:'operator',content:'The earlier work-cost reconciliation remains unresolved.'},user('If a seller does not text back, does the conversation stay blank?')];
  assert.notEqual((await replyToSupport({kind,messages:unansweredHistory},noAI)).status,'resolved');
  unansweredHistory.push(assistant('Open the property and review Texts.'),user('Where is the training course?'));
  assert.doesNotMatch((await replyToSupport({kind,messages:unansweredHistory},noAI)).reply,/saved outgoing texts/);
  for(const question of ['The seller replied but the text conversation is blank.','If a seller does not reply, is the conversation blank? Also cancel my subscription.','If a seller does not text back, is the conversation blank? My payment failed.','If the owner has not replied, is the conversation blank? Messages disappeared.','If a seller does not reply, is the conversation blank? I cannot sign in.'])assert.equal(supportProductClarification([user(question)]),null);
  for(const question of ['When should I expect to start seeing results?','How soon can I see results?']){
   const answer=await replyToSupport({kind,messages:[user(question)]},noAI);
   assert.match(answer.reply,/new leads, seller replies, or a signed contract/);assert.doesNotMatch(answer.reply,/Which page|verify your account|troubleshooting/);assert.notEqual(answer.status,'resolved');
  }
  const resultHistory=[user('My bot has not made calls.'),{role:'operator',content:'The saved calling checks remain unresolved.'},user('When should I expect results?')];
  assert.notEqual((await replyToSupport({kind,messages:resultHistory},noAI)).status,'resolved');
  const resultTopic=await replyToSupport({kind,messages:[user('When can I see results?'),assistant('Do you mean new leads, seller replies, or a signed contract?'),user('Where is the course?')]},noAI);
  assert.match(resultTopic.reply,/course/i);assert.doesNotMatch(resultTopic.reply,/new leads, seller replies/);
  for(const question of ['When will search results load?','When will my payment results update?','When will I get results? Cancel my subscription.']){
   assert.doesNotMatch(supportConversationFallback({kind,messages:[user(question)]}).reply,/new leads, seller replies, or a signed contract/);
  }
  for(const question of ['So the contact info doesn’t show automatically the bot find it?','Do the property contacts automatically come up or do the bot find them?','Does the contact show up the same time as the lead? Or do I have to wait for a contact?']){
   const answer=await replyToSupport({kind,messages:[user(question)],evidence:[]},noAI);
   assert.match(answer.reply,/before a usable seller phone number/);assert.match(answer.reply,/not guaranteed/);assert.doesNotMatch(answer.reply,/add listings|9 AM|Pause|Course/);assert.equal(answer.status,'resolved');
  }
  const contactHistory=[user('No numbers are listed on any of the leads'),assistant('What is your bot status?'),user('Does the contact show up the same time as the lead?')];
  assert.equal((await replyToSupport({kind,messages:contactHistory},noAI)).status,'open');
  for(const question of ['How long on Average before we see any Contracts?','When will I get a contract?','What is the average time frame for an agreement?']){
   const answer=await replyToSupport({kind,messages:[user(question)]},noAI);
   assert.match(answer.reply,/don’t have a verified average/);assert.doesNotMatch(answer.reply,/Take over|Documents tab|guaranteed.*(?:days|weeks)/);assert.equal(answer.status,'resolved');
  }
  const late=await replyToSupport({kind,messages:[user('Still no contracts. How long will it take?')]},noAI);assert.equal(late.status,'open');
  const offMarket=await replyToSupport({kind,messages:[user('Why are the leads on homes that are off the market?')]},noAI);
  assert.match(offMarket.reply,/not publicly listed/);assert.match(offMarket.reply,/does not prove an owner wants to sell/);
  for(const question of ['So I ever have to pay for minutes','Do I need to pay for mins in 1.0 or 2.0 when dialing?','Are calls included in my software subscription?']){
   const answer=await replyToSupport({kind,messages:[user(question)]},noAI);
   assert.match(answer.reply,/includes \$0 in work credits/);assert.match(answer.reply,/separately purchased prepaid/);assert.doesNotMatch(answer.reply,/add listings|couldn’t verify/);
   if(question.includes('1.0'))assert.match(answer.reply,/no longer active/);
  }
  const checkout=[user('I attempted to checkout with the free two-month offer and it did not go through.')];
  let answer=await replyToSupport({kind,messages:checkout},noAI);assert.match(answer.reply,/exact message.*checkout page/);assert.doesNotMatch(answer.reply,/newest code|Safari|email or text/);
  checkout.push(assistant(answer.reply),user('When I try to sign in with my email on file it says it doesn’t work. This is the first two months free.'));
  answer=await replyToSupport({kind,messages:checkout},noAI);assert.equal(answer.status,'open');assert.match(answer.reply,/checkout has not been confirmed/);assert.doesNotMatch(answer.reply,/enter the newest code|Safari|email or text/);
  const wrong=[user('I used the wrong email at checkout.')];answer=await replyToSupport({kind,messages:wrong},noAI);
  assert.match(answer.reply,/purchase-ownership check/);assert.doesNotMatch(answer.reply,/enter the newest code|Safari|email or text/);
  wrong.push({role:'operator',content:'Please send the merchant receipt so we can match the purchase before an email correction.'},user('Update correct email?'));
  answer=await replyToSupport({kind,messages:wrong},noAI);assert.equal(answer.status,'open');assert.match(answer.reply,/earlier proof details/);assert.doesNotMatch(answer.reply,/Email your merchant receipt/);
  answer=await replyToSupport({kind,messages:[user('So there was a call I just can’t see it because the calling service couldn’t verify against its approved setup?')]},noAI);
  assert.equal(answer.status,'open');assert.match(answer.reply,/not proof that a call reached a seller/);assert.doesNotMatch(answer.reply,/Yes, exactly|we handle/);
  answer=await replyToSupport({kind,messages:[user('How long will it take for the calling service setup to be fixed on the backend?')]},noAI);
  assert.equal(answer.status,'open');assert.match(answer.reply,/don’t have a verified repair time/);assert.doesNotMatch(answer.reply,/will resume automatically/);
  for(const question of ['Cancel my subscription','I was charged twice for calls','My card was declined','The contact checks expired before this follow-up could be sent','I can’t download the contract','The seller phone numbers are invalid']){
   const answer=supportConversationFallback({kind,messages:[user(question)]});
   assert.notEqual(answer.status,'resolved');assert.doesNotMatch(answer.reply,/before a usable seller phone number|verified average|includes \$0/);
  }
 }
 assert.equal(calls,0);
}finally{process.env=env;}
console.log('PASS inbox clarifications: contact availability, contract timing, off-market meaning, usage costs, checkout failures, wrong email, topic boundaries and unresolved failures; offline only.');
