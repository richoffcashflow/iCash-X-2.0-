import assert from 'node:assert/strict';
import {supportConversationFallback,replyToSupport} from '../lib/support-conversation.ts';
import {unsupportedSupportReply} from '../lib/support-reply-guardrails.ts';
import {supportProductGuide} from '../lib/support-product-guide.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const noSms=reply=>assert.doesNotMatch(reply,/checkout phone|Text me a code|email or text|enter.{0,20}(?:text|sms) code/i);
for(const kind of ['access','account'])for(const phone of ['configured','unavailable','unknown']){
 const accessInvestigation={checked:true,email:'configured',phone,recovery:'checked'};
 const history=[user('My email sign-in code never arrived')];
 for(const question of [null,'Yes, the email matches my receipt','Still no email code','Email me a code','I already tried that']){
  if(question)history.push(user(question));
  const answer=await replyToSupport({kind,messages:history,accessInvestigation},()=>{throw Error('Access replies are local');});
  noSms(answer.reply);assert.notEqual(answer.status,'resolved');assert.equal(answer.ai,false);history.push(assistant(answer.reply));
 }
 const unknown=supportConversationFallback({kind,messages:[user('I entered the code but nothing happened')],accessInvestigation});
 noSms(unknown.reply);assert.match(unknown.reply,/email sign-in/i);
 const mobile=supportConversationFallback({kind,messages:[user('I entered the code on my phone but nothing happened')],accessInvestigation});
 noSms(mobile.reply);assert.match(mobile.reply,/email sign-in|device and browser/i);assert.doesNotMatch(mobile.reply,/payment receipt|confirm delivery/i);
 const missing=supportConversationFallback({kind,messages:[user('I never got the code')],accessInvestigation});
 noSms(missing.reply);assert.match(missing.reply,/payment receipt/i);assert.doesNotMatch(missing.reply,/enter the newest code/i);
 const stale=supportConversationFallback({kind,messages:[user('My login code never arrived'),assistant('Choose Use my checkout phone and Text me a code.'),user('Text')],accessInvestigation});
 noSms(stale.reply);assert.notEqual(stale.status,'resolved');
 const typo=supportConversationFallback({kind,messages:[user('I used the wrong email at checkout and cannot log in')],accessInvestigation});
 noSms(typo.reply);assert.match(typo.reply,/purchase.*verif|purchase-ownership check/i);assert.notEqual(typo.status,'resolved');
}
for(const text of ['Choose Use my checkout phone.','Request a text code.','Enter the SMS code.','Try a code by SMS.','Are you using email or text?','Sign in via SMS.','Use SMS to receive your verification code.','You can log in with your phone number.'])assert.equal(unsupportedSupportReply(text,[],[]),true,text);
for(const text of ['Your bot can contact sellers by text.','Verify the seller phone number before outreach.'])assert.equal(unsupportedSupportReply(text,[],[]),false,'Ordinary seller outreach remains supported');
assert.match(supportProductGuide,/SMS verification and checkout-phone sign-in are not available/);
console.log('PASS email-only support: unavailable and stale configured SMS diagnostics, missing/entered codes, historical instructions, email typo verification and model output guard; outreach unchanged.');
// The actual model adapter rejects stale SMS instructions outside the local access route.
const saved={ICASH_SUPPORT_AI_ENABLED:process.env.ICASH_SUPPORT_AI_ENABLED,OPENAI_API_KEY:process.env.OPENAI_API_KEY,ICASH_SUPPORT_AI_MODEL:process.env.ICASH_SUPPORT_AI_MODEL};
Object.assign(process.env,{ICASH_SUPPORT_AI_ENABLED:'true',OPENAI_API_KEY:'fixture',ICASH_SUPPORT_AI_MODEL:'fixture'});
try{
 let calls=0;
 for(const staleReply of ['Try a code by SMS.','Sign in via SMS.','Use SMS to receive your verification code.','You can log in with your phone number.']){
 const context={kind:'account',messages:[user('My settings page is blank')]};
 const answer=await replyToSupport(context,async(_url,init)=>{calls++;assert.match(JSON.parse(init.body).messages[0].content,/SMS verification and checkout-phone sign-in are not available/);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:staleReply,answered:false})}}]});});
 assert.equal(answer.ai,false);assert.equal(answer.reply,supportConversationFallback(context).reply);noSms(answer.reply);
 }
 assert.equal(calls,4);
}finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
