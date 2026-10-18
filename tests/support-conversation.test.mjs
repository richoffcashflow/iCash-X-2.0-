import assert from 'node:assert/strict';
import {supportConversationFallback,replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const check=(key,status,code)=>({key,status,code,detail:`Fixture ${key} check.`,source:'fixture',observedAt:'2026-10-17T18:00:00Z'});
const ready=[check('work','ok','not_paused'),check('credits','ok','credit_available'),check('readiness','ok','readiness_ready')];
const leadsContext={kind:'account',messages:[user('How do I get a client?')],evidence:ready};
for(const question of ['How do I get a client?','Where do leads come from?','Do I need to find clients myself?','No leads yet, what do I do?','How do I get started?']){
 const response=supportConversationFallback({...leadsContext,messages:[user(question)]});
 assert.match(response.reply,/Course/);assert.match(response.reply,/running/);assert.match(response.reply,/Leads and notifications/);assert.match(response.reply,/no fixed arrival time/);
 assert.doesNotMatch(response.reply,/marketing|networking|referrals|social media|what (?:type of )?(?:service|product)/i);assert.equal(response.status,'resolved');assert.match(response.reply,/rewatch the Course/);
}
const paused=supportConversationFallback({...leadsContext,evidence:[...ready.filter(c=>c.key!=='work'),check('work','attention','paused')]});
assert.match(paused.reply,/currently paused/);assert.match(paused.reply,/Run bot/);assert.doesNotMatch(paused.reply,/Keep it running/);
assert.equal(paused.status,'waiting_on_customer','A suggested action alone does not confirm an actual problem is resolved');
const empty=supportConversationFallback({...leadsContext,evidence:[...ready.filter(c=>c.key!=='credits'),check('credits','attention','no_available_credit')]});
assert.match(empty.reply,/no available work credits/);assert.match(empty.reply,/already paid/);
const blocked=supportConversationFallback({...leadsContext,evidence:[...ready.filter(c=>c.key!=='readiness'),check('readiness','attention','readiness_blocked')]});
assert.equal(blocked.status,'escalated');assert.match(blocked.reply,/adding credits will not clear/);assert.doesNotMatch(blocked.reply,/Keep it running/);
const missingCredit=supportConversationFallback({...leadsContext,evidence:[...ready,check('payments','attention','payment_uncredited')]});
assert.equal(missingCredit.status,'escalated');assert.match(missingCredit.reply,/before you pay again/);
assert.match(supportConversationFallback({...leadsContext,evidence:[...ready,check('subscription','attention','renewal_payment_failed')]}).reply,/software access needs attention/);
assert.match(supportConversationFallback({...leadsContext,evidence:[]}).reply,/can’t confirm.*checks.*What status/s);
assert.equal(supportConversationFallback({...leadsContext,evidence:[]}).status,'waiting_on_customer');
const watched=[user('I watched the course. How do I get my first lead?')];
let courseAnswer=supportConversationFallback({...leadsContext,messages:watched});assert.doesNotMatch(courseAnswer.reply,/Watch the Course/);
watched.push(assistant(courseAnswer.reply),user('Still waiting'));
assert.match(supportConversationFallback({...leadsContext,messages:watched}).reply,/eligible opportunity/);
assert.doesNotMatch(supportConversationFallback({...leadsContext,messages:[user('How do I get clients?'),assistant('Watch the Course in your workspace.'),user('I already watched it')]}).reply,/Watch the Course/);
assert.match(supportConversationFallback({...leadsContext,messages:[user('Where is the course?')]}).reply,/PDF download and practice workspace/);
assert.match(supportConversationFallback({kind:'access',messages:[user('How do I get clients?')],evidence:ready}).reply,/can’t confirm/,'Guest guidance cannot use account checks');
assert.match(supportConversationFallback({...leadsContext,messages:[user('How do I get clients?'),assistant('Watch the course.'),user('Cancel my subscription')]}).reply,/do not cancel/);
let history=[user('Filled out the code & nothing happened.')];
let answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/email or text/);
history.push(assistant(answer.reply),user('Email'));answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/device and browser/);assert.doesNotMatch(answer.reply,/email or text/);
history.push(assistant(answer.reply),user('iPhone Safari'));answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/error message/);
history.push(assistant(answer.reply),user('Nothing, no error'));answer=supportConversationFallback({kind:'access',messages:history});assert.equal(answer.status,'escalated');
// Missing delivery is a distinct step: never tell a customer to enter an absent code.
for(const question of [
 'I’m trying to login it will not send me a email or text',
 'I’ve entered my phone number and email but have not gotten a sign in code to either and I already paid',
 'It never sent me the sign in code in the first place',
 'The email code has not arrived',
 "I haven't received the email",
 "It didn't send a text",
 'No email code',
 'Still waiting for my text code',
 'I cannot get either code',
]){
 const missing=supportConversationFallback({kind:'access',messages:[user('I need my email sign-in code'),user(question)]});
 assert.equal(missing.status,'waiting_on_customer');assert.match(missing.reply,/email on your iCash X payment receipt/);assert.match(missing.reply,/Text sign-in also needs that email/);
 assert.doesNotMatch(missing.reply,/enter the newest code|press the sign-in button|device and browser|error message|code is on its way/i);
}
assert.match(supportConversationFallback({kind:'access',messages:[user('It never sent me the code')]}).reply,/email or text/);
const missingHistory=[user('It will not send me a email or text')];
let missingAnswer=supportConversationFallback({kind:'access',messages:missingHistory});
missingHistory.push(assistant(missingAnswer.reply),user('Yes, the email matches my receipt'));
missingAnswer=supportConversationFallback({kind:'access',messages:missingHistory});assert.match(missingAnswer.reply,/request one fresh code/);assert.match(missingAnswer.reply,/spam or junk/);
missingHistory.push(assistant(missingAnswer.reply),user('Still no code in either inbox or text'));
missingAnswer=supportConversationFallback({kind:'access',messages:missingHistory});assert.equal(missingAnswer.status,'escalated');assert.match(missingAnswer.reply,/checkout-email match and code delivery/);assert.doesNotMatch(missingAnswer.reply,/press the sign-in|device and browser/i);
for(const confirmation of ['I got the email code now, but it says expired','I have the code now, but it says invalid','Got it now, but it says expired']){
 const received=supportConversationFallback({kind:'access',messages:[...missingHistory.slice(0,-1),user('iPhone Safari'),user(confirmation)]});
 assert.match(received.reply,/Request one fresh code and enter that newest code/);assert.doesNotMatch(received.reply,/hasn’t arrived|Does the receipt email match/);
}
const staleInstructions=[user('My email code has not arrived'),assistant('Enter the newest code in Safari.'),user('iPhone Safari')];
assert.match(supportConversationFallback({kind:'access',messages:staleInstructions}).reply,/payment receipt/,'Support instructions and browser details do not imply receipt');
for(const question of ['No email code works','I am not getting past the sign-in screen'])assert.doesNotMatch(supportConversationFallback({kind:'access',messages:[user('iPhone Safari email code'),user(question)]}).reply,/hasn’t arrived|receipt email match/,'Rejected codes and a stuck screen are not missing delivery');
assert.equal(supportConversationFallback({kind:'access',messages:[...missingHistory,user('Cancel my subscription')]}).status,'escalated');
assert.equal(supportConversationFallback({kind:'access',messages:missingHistory,handedOff:true}).status,'escalated');
assert.equal(supportConversationFallback({kind:'access',messages:[user('That worked, I’m in!')]}).status,'resolved');
assert.notEqual(supportConversationFallback({kind:'access',messages:[user('That worked but I am still stuck')]}).status,'resolved');
assert.notEqual(supportConversationFallback({kind:'access',messages:[user('I got in. Why is the course not opening?')]}).status,'resolved','Confirmation with an unanswered question is not a complete resolution');
assert.equal(supportConversationFallback({...leadsContext,messages:[user('How do I get clients?'),assistant('Your bot works eligible leads automatically.'),user('Thanks!')]}).status,'resolved');
assert.notEqual(supportConversationFallback({...leadsContext,messages:[user('Bot stopped'),assistant('Which screen are you on?'),user('Thanks!')]}).status,'resolved');
assert.equal(supportConversationFallback({kind:'account',messages:[user('I want a human')]}).status,'escalated');
assert.match(supportConversationFallback({kind:'account',messages:[user('cancel my subscription')]}).reply,/do not cancel/);
assert.equal(supportConversationFallback({kind:'account',messages:[{role:'operator',content:'Checking this.'},user('Any update?')]}).status,'escalated');
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture-only';process.env.ICASH_SUPPORT_AI_MODEL='fixture-model';
try{
 let leadCalls=0;
 const generic=async()=>{leadCalls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'To get a client, focus on marketing your services clearly, networking in relevant communities, and delivering quality work. What type of service or product are you offering?',needsTeam:false,answered:false})}}]});};
 const firstClient=await replyToSupport(leadsContext,generic);assert.match(firstClient.reply,/bot finds and works eligible seller leads automatically/);assert.equal(leadCalls,0,'Known course flow cannot be replaced by generic model advice');
 assert.equal((await replyToSupport({...leadsContext,allowAI:false},generic)).reply,firstClient.reply,'Interrupted/replayed requests retain course guidance');
 for(const question of ['How do I use Take over?','How do I use my custom voice?','How do I view a new lead?']){
  const feature=await replyToSupport({...leadsContext,messages:[user(question)]},async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Fixture feature-specific answer.',needsTeam:false,answered:false})}}]}));
  assert.equal(feature.reply,'Fixture feature-specific answer.','Specific feature questions must reach course-grounded conversation, not generic onboarding');
 }
 await replyToSupport({kind:'account',messages:[user('What happens after the seller signs?')],evidence:ready},async(url,init)=>{
  const body=JSON.parse(init.body),policy=body.messages[0].content;
  assert.match(policy,/automated member.*Support team/);assert.match(policy,/not asking how to market a freelance service/);assert.match(policy,/After a seller signs, the customer reviews/);assert.match(policy,/no outbound AI calls to buyers/);assert.match(policy,/Support team chat is available without VIP/);assert.match(policy,/Checks take precedence/);
  assert.equal(JSON.parse(body.messages[1].content).verifiedChecks[0].code,'not_paused');
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Review the seller conversation, numbers and agreement in Documents, then sign if appropriate. Which step are you on?',needsTeam:false,answered:false})}}]});
 });
 const context={kind:'account',messages:[user('The bot stopped'),assistant('Which screen?'),user('The workspace, sk_live_abcdefghijkl and me@example.invalid')],evidence:[{key:'work',status:'attention',detail:'The bot is paused.',source:'fixture',observedAt:new Date().toISOString()}]};let calls=0;
 const fetcher=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(body.store,false);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);assert(init.signal);assert.match(body.messages[1].content,/Which screen/);assert(!body.messages[1].content.includes('sk_live_abcdefghijkl'));assert(!body.messages[1].content.includes('me@example.invalid'));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Your bot is paused. Are you ready to resume it from the workspace?',needsTeam:false,answered:false})}}]});};
 const response=await replyToSupport(context,fetcher);assert(response.ai);assert.match(response.reply,/paused/);assert.equal(calls,1);
 const modelReply=(reply,answered,needsTeam=false)=>async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,needsTeam,answered})}}]});
 const complete=await replyToSupport({...leadsContext,messages:[user('What is Take over?')]},modelReply('Take over pauses new automatic work on that property so you can handle it yourself.',true));
 assert.equal(complete.status,'resolved');assert.match(complete.reply,/rewatch the Course/);assert.match(complete.reply,/Reply here/);
 const missing=await replyToSupport(context,modelReply('Which screen are you on?',true));assert.equal(missing.status,'waiting_on_customer','A model cannot close a reply that still asks a question');
 const pending=await replyToSupport(context,modelReply('Please tell us the exact error on screen.',false));assert.equal(pending.status,'waiting_on_customer');
 const staff=await replyToSupport(context,modelReply('A team member needs to review the account.',true,true));assert.equal(staff.status,'escalated','Team action takes precedence over a resolution flag');
 await replyToSupport({...context,allowAI:false},fetcher);assert.equal(calls,1,'Replay recovery never repeats a paid call');
 await replyToSupport({kind:'access',messages:[user('code does nothing')]},fetcher);assert.equal(calls,1,'Access recovery has no paid provider dependency');
 for(const bad of [{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'I have refunded your payment.',needsTeam:false,answered:false})}}]},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Open https://attacker.invalid',needsTeam:false,answered:false})}}]}])assert.equal((await replyToSupport(context,async()=>Response.json(bad))).ai,false);
 assert.equal((await replyToSupport(context,async()=>{throw Error('timeout');})).ai,false);
}finally{process.env=env;}
console.log('PASS support conversations: multi-turn missing details, resolution, human handoff, cancellation boundaries, redaction, bounded structured AI, provider failure and replay fallback; no real provider requests.');
