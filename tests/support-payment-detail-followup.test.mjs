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
