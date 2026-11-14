import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const request=o('Please email the original purchase receipt to support@geticashx.com and mention this access conversation. The purchase still needs verification.');
const emailRequest=o('Please email the checkout address to support@geticashx.com so the missing-code purchase can be located.');
const deny=async()=>{throw Error('No paid model calls');};
for(const kind of ['access','account'])for(const handedOff of [false,true])for(const messages of [[request,u('Done, I sent it to your email.')],[emailRequest,u('I already did that.')]]){
 const r=await replyToSupport({kind,handedOff,messages},deny);
 assert.match(r.reply,/you.ve said you sent/i);assert.match(r.reply,/subject and date/i);assert.match(r.reply,/not confirmed/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.equal(r.ai,false);assert.doesNotMatch(r.reply,/we received|purchase is verified|send the receipt again/i);
}
for(const messages of [[u('I already did that.')],[o('Restart the browser.'),u('I already did that.')],[request,u('I have not sent it.')],[request,u('If I sent it, would that help?')],[request,u('I sent it to my friend.')],[request,u('Done. How do I call a seller?')],[request,o('Your purchase has been verified. Please use verified recovery.'),u('I already did that.')],[request,u('Where is my course?'),u('I already did that.')],[request,u('Cancel my subscription.')],[o('Do not email the purchase receipt to support@geticashx.com.'),u('I already did that.')],[{role:'assistant',content:request.content},u('I already did that.')]]){
 const r=await replyToSupport({kind:'access',handedOff:true,messages,allowAI:false},deny);assert.doesNotMatch(r.reply,/you.ve said you sent the requested/i);
}
console.log('PASS fictional source-bound proof acknowledgments and negative/topic/operator boundaries');
