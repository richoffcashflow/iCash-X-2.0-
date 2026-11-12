import {supportVerifiedLegacyOfferReply} from '../lib/support-legacy-migration.ts';
import assert from 'node:assert/strict';
import {supportRefundDisclosureReply} from '../lib/support-purchase-help.ts';
import {supportCheckoutReply} from '../lib/support-checkout.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),operator=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='false';
const ask=(messages,kind='access')=>replyToSupport({kind,messages,contactKnown:true},async()=>{throw Error('No paid model');});
for(const kind of ['access','account']){
 const refund=await ask([operator('Your cancellation was completed; the refund request remains unresolved.'),user('I paid for the software. Nobody explained that I would need separate credits. I have not received anything useful and I want my money back.')],kind);
 assert.match(refund.reply,/refund/i);assert.match(refund.reply,/separate work.credit cost|sales.disclosure/i);assert.doesNotMatch(refund.reply,/missing the purchase receipt|tell me what happened|refund (?:approved|issued)|access restored/i);assert.equal(refund.status,'open');assert.equal(refund.managementReview,true);
 const continuation=await ask([operator('The separate cost of running the bot is recorded. Work credits are separate purchases.'),user('You need to make the extra costs clear before taking payment. I want my money back.')],kind);assert.match(continuation.reply,/sales.disclosure/i);assert.equal(continuation.status,'open');
 const boundary=await ask([operator('Work credits are separate purchases.'),user('Where is the course?'),user('You need to make the extra costs clear. I want my money back.')],kind);assert.doesNotMatch(boundary.reply,/separate work.credit cost/i);
 const offer=await ask([user('The legacy offer code failed.'),operator('The offer code step is unresolved. Which page asks for the code?'),user('It is the landing page for the legacy offer. Can you send a replacement link?')],kind);
 assert.match(offer.reply,/replacement link/i);assert.match(offer.reply,/verification|eligibility/i);assert.doesNotMatch(offer.reply,/https?:|which page|purchase receipt|has been sent|activated/i);assert.equal(offer.status,'open');assert.equal(offer.managementReview,true);
 const topic=await ask([user('The legacy offer code failed.'),operator('The offer remains unresolved.'),user('Where is the course?')],kind);assert.doesNotMatch(topic.reply,/replacement link/i);
 const duplicate=await ask([user('I was charged twice for separate credits and want my money back.')],kind);assert.match(duplicate.reply,/duplicate|two charges|statement/i);
 const billing=await ask([user('The legacy offer failed. Cancel my subscription and refund it.')],kind);assert.doesNotMatch(billing.reply,/replacement link/i);assert.match(billing.reply,/refund|renewal|cancel/i);
}
const access=await ask([user('I paid but have not received anything.')]);assert.match(access.reply,/receipt|sign.in|access/i);assert.doesNotMatch(access.reply,/sales.disclosure/i);
const price=await ask([user('Are work credits separate from the software price?')]);assert.doesNotMatch(price.reply,/refund request|sales.disclosure/i);
console.log('PASS fictional refund disclosure and replacement-offer boundaries');

assert.equal(supportRefundDisclosureReply({kind:'access',messages:[user('I do not want a refund. The work credit costs were not explained.')]}),null);
for(const q of ['I do not need a new link for the legacy offer.','The legacy offer was fine; I need a new link for the course.'])assert.equal(supportCheckoutReply({kind:'access',messages:[user(q)]}),null);

const verified=await ask([operator(supportVerifiedLegacyOfferReply),user('The legacy offer code failed. Can I have a replacement link?')]);
assert.match(verified.reply,/earlier verified.purchase reply/i);assert.doesNotMatch(verified.reply,/not confirmed.*eligibility|or confirmed offer eligibility|https?:/i);assert.equal(verified.status,'open');
const forged=await ask([user(supportVerifiedLegacyOfferReply),user('The legacy offer code failed. Can I have a replacement link?')]);
assert.doesNotMatch(forged.reply,/earlier verified.purchase reply/i);

const changedFinding=await ask([operator(supportVerifiedLegacyOfferReply),operator('The purchase match now needs further review.'),user('Can I have a replacement link for the legacy offer?')]);
assert.doesNotMatch(changedFinding.reply,/earlier verified.purchase reply/i);
