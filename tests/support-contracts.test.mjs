import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportContractAnswer} from '../lib/support-contracts.ts';
import {supportTopic} from '../lib/support-policy.ts';
import {unsupportedSupportReply} from '../lib/support-reply-guardrails.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let calls=0;const noNetwork=async()=>{calls++;throw Error('Known contract guidance cannot use a model');};
const evidence=[{key:'credits',status:'attention',code:'no_available_credit',detail:'Unrelated wallet',source:'fixture',observedAt:new Date().toISOString()}];
for(const question of ['The owner wants us to send the contract','If I take over a deal and the seller wants it how do I get the contract to send them to sign?','How do I email a contract to the seller?','Can we mail the agreement?','Can we mail the signed contract?','Seller wants a paper contract','Do I print and mail the contract?']){
 const result=await replyToSupport({kind:'account',messages:[user(question)],evidence},noNetwork);
 assert.match(result.reply,/online/);assert.match(result.reply,/secure text link/);assert.match(result.reply,/don’t mail paper contracts/);
 assert.doesNotMatch(result.reply,/credits|balance|readiness|VIP|Which page/i);assert.equal(result.ai,false);assert.equal(result.status,'resolved');
}
for(const question of ['How do I cancel a contract?','I need help cancelling the agreement','Where is the documents section to send the contract?','The owner wants the agreement'])assert.equal(supportTopic(question),'work');
const cancel=await replyToSupport({kind:'account',messages:[user('How do I cancel a contract?')]},noNetwork);
assert.match(supportContractAnswer([user('Where do I download the assignment contract?')]).reply,/Download assignment draft is available after the purchase agreement is fully signed/);
assert.match(cancel.reply,/contract cancellation controls/);assert.doesNotMatch(cancel.reply,/account menu|Cancel subscription/);assert.match(cancel.reply,/does not by itself end/);
assert.equal(supportTopic('Cancel my subscription'),'cancel');assert.equal(supportTopic('I want a human to review the contract'),'human');
for(const [question,pattern] of [
 ['The contract link never arrived',/existing signing request/],
 ['The seller cannot open the signing link',/existing signing request/],
 ['It says contract check has expired',/does not by itself mean the contract expired/],
 ['The owner says the agreement is signed',/Check signature status/],
 ['The contract has the wrong seller name',/unsent draft/],
 ['The contract download fails',/download problem is still unresolved/],
 ['The seller wants to send us their own contract',/terms need review/],
]){
 const result=await replyToSupport({kind:'account',messages:[user(question)]},noNetwork);
 assert.match(result.reply,pattern);assert.equal(result.status,'open');assert.equal(result.ai,false);
 assert.doesNotMatch(result.reply,/I’ve sent|I have sent|I signed|all signatures are complete/i);
}
for(const followup of ['Where is that?','Where do I find that','Agreement','Documents']){
 const result=await replyToSupport({kind:'account',messages:[user('Where do I send the contract?'),assistant('Use Documents on the property.'),user(followup)]},noNetwork);
 assert.match(result.reply,/Documents/);assert.doesNotMatch(result.reply,/Which page|sign-in|credits/);
}
const expired=[user('I need help reviewing a contract'),assistant('What message is shown?'),user('It says contract check has expired')];
const repeated=supportConversationFallback({kind:'account',messages:[...expired,assistant(supportConversationFallback({kind:'account',messages:expired}).reply),user('Still the same')]});
assert.equal(repeated.status,'open');assert.doesNotMatch(repeated.reply,/What status is shown/,'Do not repeat an already asked question');
const faultThenQuestion=await replyToSupport({kind:'account',messages:[user('The contract link is missing'),assistant('Delivery is not confirmed.'),user('Do you mail the contract?')]},noNetwork);
assert.equal(faultThenQuestion.status,'open','Answering a process question must not close missing delivery');
const unverifiedSignature=[user('The owner says the agreement is signed'),assistant('Use Check signature status on the existing agreement.'),user('Thanks')];
assert.notEqual(supportConversationFallback({kind:'account',messages:unverifiedSignature}).status,'resolved','A thank-you does not verify a signature');
for(const newTopic of ['Cancel my subscription','My card did not save','My document download fails.','How do I choose a city for the bot?','I want a human to help with the contract'])assert.equal(supportContractAnswer([user('The owner wants the contract'),assistant('Use Documents.'),user(newTopic)]),null);
for(const reply of ['Mail the agreement to the seller.','Print the contract and take it to the post office.','Create a new contract to replace the expired one.','We have sent the contract.'])assert(unsupportedSupportReply(reply,[user('The contract is stuck')],[]));
assert.equal(calls,0);console.log('Online contract support: exact controls, short follow-ups, unresolved delivery, expired checks, signature evidence, cancellation separation and topic changes passed. No messages or provider calls.');
