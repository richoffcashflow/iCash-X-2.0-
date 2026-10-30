import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportSimpleProductAnswer} from '../lib/support-product-guide.ts';
import {supportReplyEvidence} from '../lib/support-reply-style.ts';

// Offline replay of the reported wording and related product questions.
const user=content=>({role:'user',content});
const assistant=content=>({role:'assistant',content});
const reported='So all I need to do is sit back watch for messages that I am needed follow up where needed get the contracts to the title company and get paid ?';
const questions=[reported,
 'So I just watch notifications and step in when needed?',
 'Is all I have to do follow up on messages and send contracts to title?',
 'What is my role while the bot does the work?',
 'When do I come in with the AI?',
 'What do I need to do while my bot works?',
 'Can I just sit back and let the bot do everything?',
 'Do I only handle the contracts and closing?',
];
const checks=[
 ['readiness','readiness_blocked'],['payments','payment_uncredited'],
 ['credits','no_available_credit'],['work','paused'],
].map(([key,code])=>({key,code,status:'attention',source:'fixture',detail:'Unrelated account check.',observedAt:'2026-10-30T13:00:00Z'}));
const irrelevant=/verify your account|troubleshoot|confirm a fix|which page|what message|Documents tab|Take over|credits?|readiness|Course|upgrade|\?/i;
function assertRole(answer,status='resolved'){
 assert.match(answer.reply,/messages and notifications/);
 assert.match(answer.reply,/deal numbers and agreements before signing/);
 assert.match(answer.reply,/title company/);
 assert.match(answer.reply,/closing and disbursement/);
 assert.match(answer.reply,/does not guarantee a payout/);
 assert.doesNotMatch(answer.reply,irrelevant);
 assert.equal(answer.status,status);assert.equal(answer.ai,false);
}

const env={...process.env};
try{
 process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
 let calls=0;
 const provider=async()=>{calls++;throw Error('Product guidance must not call a provider');};
 for(const kind of ['account','access'])for(const evidence of [[],checks])for(const question of questions){
  const context={kind,messages:[user(question)],evidence};
  assert.deepEqual(supportReplyEvidence(context.messages,evidence),[]);
  assertRole(supportConversationFallback(context));
  assertRole(await replyToSupport(context,provider));
  assertRole(await replyToSupport({...context,allowAI:false},provider));
 }
 // An unrelated side question or partial history cannot resolve a real failure.
 for(const kind of ['account','access']){
  assertRole(await replyToSupport({kind,messages:[user('My bot is not calling'),assistant('The call issue is unresolved.'),user(reported)],evidence:checks},provider),'open');
  assertRole(await replyToSupport({kind,messages:[user(reported)],historyComplete:false,evidence:checks},provider),'open');
  // Earlier bad support text does not turn a general question into an account error.
  assertRole(await replyToSupport({kind,messages:[assistant('I couldn’t verify your account details just now. What message do you see on that page?'),user(reported)],evidence:checks},provider));
 }
 assert.equal(calls,0);
}finally{process.env=env;}

for(const question of [
 'Do I just watch messages? My bot stopped working.',
 'What is my role if the contract download fails?',
 'So I just watch notifications but my bot is not calling?',
 'Do I only handle contracts? I cannot sign in.',
 'Can I just wait for the bot? I was charged twice.',
 'What is my role? Cancel my subscription.',
 'Do I just watch notifications? The contact checks expired.',
 'Do I just wait for messages? My bot has 0 calls.',
 'Do I just watch messages? The bot is not making calls.',
 'What is my role with the bot? Help me sign in.',
]){
 assert.equal(supportSimpleProductAnswer(question),null,question);
 assert.notEqual(supportConversationFallback({kind:'account',messages:[user(question)],evidence:checks}).status,'resolved',question);
}
assert.match(supportConversationFallback({kind:'account',messages:[user('Where do I download the assignment contract?')]}).reply,/after the purchase agreement is signed/);
assert.match(supportConversationFallback({kind:'account',messages:[user('How do I create a contract?')]}).reply,/Take over.*Seller is ready for an agreement/);
assert.match(supportConversationFallback({kind:'account',messages:[user('What do I need to do to create a contract with the bot?')]}).reply,/Take over.*Seller is ready for an agreement/);
assert.match(supportConversationFallback({kind:'account',messages:[user('Do I just watch notifications? The contact checks expired.')]}).reply,/saved contact checks expired/);
const resolution=supportConversationFallback({kind:'account',messages:[user('Is all I need to do save a resolution note for the seller follow-up?')]});
assert.match(resolution.reply,/internal note/);assert.equal(resolution.status,'open');
console.log('PASS support role guidance: product answers survive missing checks, bad prior replies and model outages; real failures stay open.');
