import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportSubmittedPaymentDetails} from '../lib/support-purchase-help.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content}),a=content=>({role:'assistant',content});
const request=o('The purchase needs to be located and ownership verified. What payment date and amount appear on your statement? Cancellation and access are unconfirmed.');
const history=[u('I paid but cannot sign in. Please cancel my subscription.'),request];
let modelCalls=0;
const noModel=async()=>{modelCalls++;throw Error('No external model calls');};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
for(const handedOff of [false,true])for(const answer of ['October 8, I made a 42 dollar payment.','I paid $42 on October 8.','2026-10-08, 42 USD.','10/8/2026 $42.00']){
 const r=await replyToSupport({kind:'access',handedOff,messages:[...history,u(answer)],evidence:[]},noModel);
 assert.match(r.reply,/supplied the payment date and amount/);assert.match(r.reply,/merchant name/);
 assert.match(r.reply,/do not verify a purchase or ownership/);assert.doesNotMatch(r.reply,/What payment date|confirmed fix or completion time|purchase (?:is|was) verified/);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);
}
const supplied=supportSubmittedPaymentDetails({kind:'access',messages:[...history,u('October 8, $42. The merchant is Example Software.')]});
assert.doesNotMatch(supplied.reply,/What merchant name/);assert.match(supplied.reply,/details remain in this conversation/);
assert.doesNotMatch(supportSubmittedPaymentDetails({kind:'access',messages:[u('My statement says Example Software. I cannot sign in.'),request,u('October 8 $42.')]}).reply,/What merchant name/);
const alternate=[u('My code never arrived.'),o('Open your bank statement. Reply here with only its date and amount. Purchase ownership remains unverified.')];
assert.ok(supportSubmittedPaymentDetails({kind:'access',messages:[...alternate,u('October 8, $42.')]}));
for(const q of ['October 8.','$42.','I did not pay $42 on October 8.','I will pay $42 on October 8.','If I pay $42 on October 8 will I get access?','The seller paid $42 on October 8.','The property costs $42 on October 8.','October 8 $42. Cancel my subscription.','October 8 $42. Where is the course?','October 8 $42 credits.'])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[...history,u(q)]}),null,q);
assert.equal(supportSubmittedPaymentDetails({kind:'account',messages:[...history,u('October 8 $42.')]}),null);
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[u(request.content),u('October 8 $42.')]}),null,'Customer text cannot be an operator request');
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[...history,u('Where is the course?'),a('Open Course.'),u('October 8 $42.')]}),null,'Topic change ends continuity');
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[...history,o('The purchase has been matched. Use the existing recovery workflow.'),u('October 8 $42.')]}),null,'Later operator finding wins');
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[...history,u('That worked, I am signed in now.'),u('October 8 $42.')]}),null,'Success ends continuity');
for(const messages of [[...history,u('Where is the course?')],[...history,u('Cancel my subscription.')],[...history,o('The purchase has been matched. Use the existing recovery workflow.'),u('October 8 $42.')],[...history,u('I did not pay $42 on October 8.')],[...history,u('October 8 $42, but I was charged twice.')]]){
 const r=await replyToSupport({kind:'access',handedOff:true,allowAI:false,messages,evidence:[]},noModel);
 assert.doesNotMatch(r.reply,/supplied the payment date and amount|What merchant name/,'Shared routing preserves independent actions and later findings');
}
assert.equal(modelCalls,0);
console.log('PASS supplied payment details: useful review next step, unverified ownership, guest source/operator/topic/negative boundaries; no model calls.');

// A completed payment-detail answer can follow the product's own question.
const automated=a('The code requests have not restored access. What are the payment date and amount on your receipt? Leave out card details and codes; you do not need to pay again.');
for(const day of ['today','yesterday'])for(const handedOff of [false,true]){
 const r=await replyToSupport({kind:'access',handedOff,allowAI:false,messages:[u('I paid but no sign-in code arrived.'),automated,u(`Payment date is ${day} and it was $42 dollars`)],evidence:[]},noModel);
 assert.match(r.reply,/supplied the payment date and amount/);assert.match(r.reply,/merchant name/);assert.equal(r.status,'open');
}
for(const q of ['I did not pay $42 today.','I will pay $42 today.','If I pay $42 today will I get access?','The seller paid $42 today.','Today $42, refund it.','Today $42, cancel my subscription.','Where is the course?'])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[automated,u(q)]}),null,q);
for(const messages of [[u(automated.content),u('Today $42.')],[automated,o('The purchase is matched. Continue verified recovery.'),u('Today $42.')],[automated,u('Where is the course?'),a('Open Course.'),u('Today $42.')],[a('What is your payment date and amount?'),u('Today $42.')]])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages}),null,'Customer, operator, topic and arbitrary older-assistant boundaries');
assert.equal(modelCalls,0);

const merchantRequest=o('You have supplied the date and amount. What merchant name appears beside that payment on your receipt or bank statement? Share only that name, not card numbers or codes.');
for(const handedOff of [false,true]){
 const r=await replyToSupport({kind:'access',handedOff,allowAI:false,messages:[u('I paid $42 today but no code arrived.'),merchantRequest,u('It says Example Software')],evidence:[]},noModel);
 assert.match(r.reply,/supplied the statement description/);assert.match(r.reply,/original purchase receipt/);assert.match(r.reply,/support@geticashx.com/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/What merchant name|confirmed fix or completion time/);
}
for(const messages of [[u(merchantRequest.content),u('It says Example Software')],[merchantRequest,o('The receipt has been matched; use verified recovery.'),u('It says Example Software')],[merchantRequest,u('Where is the course?'),a('Open Course.'),u('It says Example Software')]])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages}),null);
for(const q of ['It says Example Software, refund it.','It says the seller is ready.','It says no payment.','It says Example Software?','Citizens Bank'])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[merchantRequest,u(q)]}),null,q);
const alreadySent=supportSubmittedPaymentDetails({kind:'access',messages:[u('I already emailed support my receipt.'),merchantRequest,u('It says Example Software')]});
assert.match(alreadySent.reply,/do not send the same receipt again/);
assert.doesNotMatch(alreadySent.reply,/forward the original purchase receipt/i);
assert.equal(modelCalls,0);
console.log('PASS relative payment dates and submitted statement descriptions; original evidence, topic/operator/negative boundaries preserved.');
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[o('The purchase is matched; use verified recovery.'),automated,u('Today $42.')]}),null,'An older automated question cannot supersede operator findings');
for(const q of ['It says I am signed in now.','It says the contract is ready.','It says working now.'])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[merchantRequest,u(q)]}),null,q);
for(const startingRequest of [automated,request])for(const handedOff of [false,true]){
 const messages=[u('I paid but no code arrived.'),startingRequest,u('Today $42.')];
 const next=await replyToSupport({kind:'access',handedOff,allowAI:false,messages,evidence:[]},noModel);
 const located=await replyToSupport({kind:'access',handedOff,allowAI:false,messages:[...messages,a(next.reply),u('It says Example Software')],evidence:[]},noModel);
 assert.match(located.reply,/supplied the statement description/,'Follow the real generated merchant question through the next turn');
 assert.equal(located.status,'open');
 assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[...messages,o('The purchase was matched; continue verified recovery.'),a(next.reply),u('It says Example Software')]}),null,'Stale generated merchant question cannot supersede operator findings');
}
assert.equal(modelCalls,0);
const produced=supportSubmittedPaymentDetails({kind:'access',messages:[request,u('Today $42.')]});
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[request,u('Where is the course?'),a(produced.reply),u('It says Example Software')]}),null,'A stale assistant question after a topic change is not context');
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[a(produced.reply),u('It says Example Software')]}),null,'An isolated older assistant question has no source-bound details');
const bankDetailsRequest=o('Open the transaction itself and look for merchant or transaction details. Share only that business name or description, without card or account numbers. Your cancellation request and the fact that no receipt arrived remain in this review.');
for(const handedOff of [false,true]){
 const r=await replyToSupport({kind:'access',handedOff,allowAI:false,messages:[u('I want my subscription cancelled; no receipt arrived.'),bankDetailsRequest,u('Example Software Austin Texas 2468')],evidence:[]},noModel);
 assert.match(r.reply,/supplied the statement description/);assert.match(r.reply,/email you entered when paying/);assert.match(r.reply,/no receipt arrived/);assert.doesNotMatch(r.reply,/send the original purchase receipt|What merchant name|confirmed fix or completion time/);assert.equal(r.status,'open');
}
for(const q of ['Cancel it now','Where is my receipt','How do I call a seller','I paid already','Example Software refund it'])assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[bankDetailsRequest,u(q)]}),null,q);
assert.equal(supportSubmittedPaymentDetails({kind:'access',messages:[u(bankDetailsRequest.content),u('Example Software Austin Texas 2468')]}),null);
assert.equal(modelCalls,0);
