import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const request=o('Please email the original purchase receipt to support@geticashx.com and mention this access conversation. The purchase still needs verification.');
const emailRequest=o('Please email the checkout address to support@geticashx.com so the missing-code purchase can be located.');
let providerCalls=0;const deny=async()=>{providerCalls++;throw Error('No paid model calls');};
for(const kind of ['access','account'])for(const handedOff of [false,true])for(const messages of [[request,u('Done, I sent it to your email.')],[emailRequest,u('I already did that.')]]){
 const r=await replyToSupport({kind,handedOff,messages},deny);
 assert.match(r.reply,/you.ve said you sent/i);assert.match(r.reply,/subject and date/i);assert.match(r.reply,/not confirmed/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);assert.doesNotMatch(r.reply,/we received|purchase is verified|send the receipt again/i);
}
for(const messages of [[u('I already did that.')],[o('Restart the browser.'),u('I already did that.')],[request,u('I have not sent it.')],[request,u('If I sent it, would that help?')],[request,u('I sent it to my friend.')],[request,u('Done. How do I call a seller?')],[request,o('Your purchase has been verified. Please use verified recovery.'),u('I already did that.')],[request,u('Where is my course?'),u('I already did that.')],[request,u('Cancel my subscription.')],[o('Do not email the purchase receipt to support@geticashx.com.'),u('I already did that.')],[{role:'assistant',content:request.content},u('I already did that.')]]){
 const r=await replyToSupport({kind:'access',handedOff:true,messages,allowAI:false},deny);assert.doesNotMatch(r.reply,/you.ve said you sent the requested/i);
}
console.log('PASS fictional source-bound proof acknowledgments and negative/topic/operator boundaries');
const nameRequest=o('The earlier email contained a merchant description. Reply to that email with the first and last name from checkout and the checkout email if different. The purchase is not matched yet.');
for(const kind of ['access','account'])for(const handedOff of [false,true]){
 const r=await replyToSupport({kind,handedOff,messages:[nameRequest,u('I already did that. Why does this email not match my purchase? This is frustrating.')]},deny);
 assert.match(r.reply,/checkout details requested/i);assert.match(r.reply,/do not need to send.*again/i);assert.match(r.reply,/still needs to be checked/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);assert.doesNotMatch(r.reply,/subject and date|we received|purchase is verified/i);
}
for(const messages of [
 [nameRequest,u('I have not sent those details yet.')],
 [nameRequest,u('I already did that, but I sent it to my friend.')],
 [nameRequest,u('I already did that. How do I call a seller?')],
 [nameRequest,u('I already did that. Cancel my subscription.')],
 [nameRequest,u('If I already did that, would you match the purchase?')],
 [nameRequest,u('I already did that and access is fixed.')],
 [nameRequest,o('The purchase is now matched; continue through verified account recovery.'),u('I already did that.')],
 [{role:'assistant',content:nameRequest.content},u('I already did that.')],
 [o('Do not reply to that email with the first and last name or checkout email.'),u('I already did that.')],
]){
 const r=await replyToSupport({kind:'access',handedOff:true,messages,allowAI:false},deny);assert.doesNotMatch(r.reply,/checkout details requested/i);
}

assert.equal(providerCalls,0);
