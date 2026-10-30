import assert from 'node:assert/strict';
import {supportConversationFallback,replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const check=(key,status,code)=>({key,status,code,detail:`Fixture ${key} check.`,source:'fixture',observedAt:'2026-10-17T18:00:00Z'});
const ready=[check('work','ok','not_paused'),check('credits','ok','credit_available'),check('readiness','ok','readiness_ready')];
const leadsContext={kind:'account',messages:[user('How do I get a client?')],evidence:ready};
const unrelatedChecks=[check('work','attention','paused'),check('credits','attention','no_available_credit'),check('readiness','attention','readiness_blocked'),check('course','attention','course_unrecorded')];
for(const question of [
 'What do I do if I want the bot to call properties in a specific city?',
 'How can I choose a city for my bot?',
 'Can I target a specific ZIP code?',
 'I want my bot to focus on a specific area.',
]){
 const answer=await replyToSupport({kind:'account',messages:[user(question)],evidence:unrelatedChecks},async()=>{throw Error('Known city guidance must not call a provider');});
 assert.equal(answer.reply,'You can’t select a specific city in the current workspace. Your bot selects markets automatically.');
 assert.equal(answer.status,'resolved');assert.equal(answer.ai,false);
 assert.doesNotMatch(answer.reply,/credits|paused|Course|readiness|Settings|\?/i);
}
for(const [question,expected] of [
 ['What’s the outreach?','Outreach means your bot contacting sellers by call or text.'],
 ['What does outreach mean?','Outreach means your bot contacting sellers by call or text.'],
 ['If I get off the app will my bot still run?','Your bot runs in the background. Closing the app doesn’t pause it.'],
 ['Do I send a text?','Texting is automatic. You can send a text yourself if you want to take over a conversation.'],
]){
 const answer=await replyToSupport({kind:'account',messages:[user(question)],evidence:unrelatedChecks});
 assert.equal(answer.reply,expected);assert.equal(answer.status,'resolved');assert.equal(answer.ai,false);
 const sideQuestion=await replyToSupport({kind:'account',messages:[user('My bot is not working'),assistant('The call is still being checked.'),user(question)],evidence:unrelatedChecks});
 assert.equal(sideQuestion.reply,expected);assert.equal(sideQuestion.status,'open','Answering a side question does not resolve an earlier failure');
}
const cityFailure=supportConversationFallback({kind:'account',messages:[user('My bot is not calling properties in my city')],evidence:unrelatedChecks});
assert.notEqual(cityFailure.status,'resolved');assert.doesNotMatch(cityFailure.reply,/select a specific city/);
for(const question of ['How do I get a client?','Do I need to find clients myself?','How do I get started?']){
 const response=supportConversationFallback({...leadsContext,messages:[user(question)]});
 if(question==='How do I get started?')assert.match(response.reply,/Course/);
 assert.match(response.reply,/Leads/);assert.doesNotMatch(response.reply,/credits?|readiness|service checks|available balance/i);
 assert.doesNotMatch(response.reply,/marketing|networking|referrals|social media|what (?:type of )?(?:service|product)/i);assert.equal(response.status,'resolved');assert.doesNotMatch(response.reply,/rewatch the Course/);
}
for(const question of ['Where do leads come from?','No leads yet, what do I do?']){
 const response=supportConversationFallback({...leadsContext,messages:[user(question)]});
 assert.equal(response.status,'open');assert.match(response.reply,/can’t verify/);assert.doesNotMatch(response.reply,/rewatch|keep.*running/i);
}
for(const question of ['How do I add the listing for this?','Where do I add listings?','How can I upload a property?','Do I need to enter leads myself?']){
 const response=await replyToSupport({...leadsContext,messages:[user(question)]},async()=>{throw Error('Listing guidance must not need the model');});
 assert.match(response.reply,/don’t need to add listings or upload properties/);assert.match(response.reply,/incoming leads appear in Leads/);assert.equal(response.ai,false);
 const held=supportConversationFallback({...leadsContext,messages:[user(question)],evidence:[check('readiness','attention','readiness_blocked')]});
 assert.equal(held.status,'resolved','A feature question needs an answer, not unrelated account troubleshooting');assert.doesNotMatch(held.reply,/Keep it running|readiness|credits/i);
}
for(const evidence of [unrelatedChecks,ready,[],[check('payments','attention','payment_uncredited')],[check('subscription','attention','renewal_payment_failed')]]){
 const answer=supportConversationFallback({...leadsContext,evidence});
 assert.match(answer.reply,/bot finds and works eligible seller leads automatically/);
 assert.doesNotMatch(answer.reply,/credits?|readiness|service checks|paid|subscription|paused/i);
 assert.equal(answer.status,'resolved');
}
const watched=[user('I watched the course. How do I get my first lead?')];
let courseAnswer=supportConversationFallback({...leadsContext,messages:watched});assert.doesNotMatch(courseAnswer.reply,/Watch the Course/);
watched.push(assistant(courseAnswer.reply),user('Still waiting'));
assert.match(supportConversationFallback({...leadsContext,messages:watched}).reply,/new lead/i);
assert.doesNotMatch(supportConversationFallback({...leadsContext,messages:watched}).reply,/credits?|readiness/i);
assert.doesNotMatch(supportConversationFallback({...leadsContext,messages:[user('How do I get clients?'),assistant('Watch the Course in your workspace.'),user('I already watched it')]}).reply,/Watch the Course/);
assert.match(supportConversationFallback({...leadsContext,messages:[user('Where is the course?')]}).reply,/PDF download and practice workspace/);
assert.match(supportConversationFallback({kind:'access',messages:[user('How do I get clients?')],evidence:ready}).reply,/bot finds and works eligible seller leads/,'Guests can get feature guidance without account checks');
assert.match(supportConversationFallback({...leadsContext,messages:[user('How do I get clients?'),assistant('Watch the course.'),user('Cancel my subscription')]}).reply,/do not cancel/);
let history=[user('Filled out the code & nothing happened.')];
let answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/email or text/);
history.push(assistant(answer.reply),user('Email'));answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/device and browser/);assert.doesNotMatch(answer.reply,/email or text/);
history.push(assistant(answer.reply),user('iPhone Safari'));answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/error message/);
history.push(assistant(answer.reply),user('Nothing, no error'));answer=supportConversationFallback({kind:'access',messages:history});assert.equal(answer.status,'waiting_on_customer');
// Missing delivery is a distinct step: never tell a customer to enter an absent code.
const configured={checked:true,email:'configured',phone:'configured',recovery:'checked'};
for(const question of ['The email code has not arrived',"I haven't received the email",'No email code','Still waiting for my text code']){
 const missing=supportConversationFallback({kind:'access',messages:[user('I need my email sign-in code'),user(question)],accessInvestigation:configured});
 assert.equal(missing.status,'waiting_on_customer');assert.match(missing.reply,/email on your iCash X payment receipt/);
 assert.doesNotMatch(missing.reply,/enter the newest code|device and browser|code is on its way/i);
}
assert.match(supportConversationFallback({kind:'access',messages:[user('It never sent me the code')]}).reply,/email or text/);
const missingHistory=[user('The email code has not arrived')];
let missingAnswer=supportConversationFallback({kind:'access',messages:missingHistory,accessInvestigation:configured});
missingHistory.push(assistant(missingAnswer.reply),user('Yes, the email matches my receipt'));
missingAnswer=supportConversationFallback({kind:'access',messages:missingHistory,accessInvestigation:configured});assert.match(missingAnswer.reply,/request one fresh code/);assert.match(missingAnswer.reply,/spam or junk/);
missingHistory.push(assistant(missingAnswer.reply),user('Still no email code'));
missingAnswer=supportConversationFallback({kind:'access',messages:missingHistory,accessInvestigation:configured});assert.match(missingAnswer.reply,/optional receipt email blank/);
for(const question of ['No code came to the phone or email',"I've already used my email and checkout phone number",'I have tried both methods it will not send me a login code']){
 const answer=supportConversationFallback({kind:'access',messages:[user('No sign-in code arrived'),user(question)],accessInvestigation:configured});
 assert.doesNotMatch(answer.reply,/request one fresh|Text me a code.” Does a box|receipt email match/);assert.notEqual(answer.status,'resolved');
}
const stalled=[user('I have tried both methods it will not send me a login code'),{role:'operator',content:'What does the main button say right now?'},user('No message appears')];
const stalledReplies=[];
for(const question of ['No message appears','I did that already','Any update?']){
 stalled.push(user(question));const next=supportConversationFallback({kind:'access',messages:stalled,accessInvestigation:configured});
 assert.notEqual(next.status,'resolved');assert.doesNotMatch(next.reply,/request one fresh|use another email or resend|team|review queue/i);
 stalledReplies.push(next.reply);stalled.push(assistant(next.reply));
}
assert.equal(new Set(stalledReplies).size,3,'The failed instructions are not repeated');
for(const confirmation of ['I got the email code now, but it says expired','I have the code now, but it says invalid','Got it now, but it says expired']){
 const received=supportConversationFallback({kind:'access',messages:[...missingHistory.slice(0,-1),user('iPhone Safari'),user(confirmation)]});
 assert.match(received.reply,/Request one fresh code and enter that newest code/);assert.doesNotMatch(received.reply,/hasn’t arrived|Does the receipt email match/);
}
const staleInstructions=[user('My email code has not arrived'),assistant('Enter the newest code in Safari.'),user('iPhone Safari')];
assert.match(supportConversationFallback({kind:'access',messages:staleInstructions}).reply,/payment receipt/,'Support instructions and browser details do not imply receipt');
for(const question of ['No email code works','I am not getting past the sign-in screen'])assert.doesNotMatch(supportConversationFallback({kind:'access',messages:[user('iPhone Safari email code'),user(question)]}).reply,/hasn’t arrived|receipt email match/,'Rejected codes and a stuck screen are not missing delivery');
assert.equal(supportConversationFallback({kind:'access',messages:[...missingHistory,user('Cancel my subscription')]}).status,'open');
assert.equal(supportConversationFallback({kind:'access',messages:missingHistory,handedOff:true}).status,'waiting_on_customer');
assert.equal(supportConversationFallback({kind:'access',messages:[user('That worked, I’m in!')]}).status,'resolved');
assert.notEqual(supportConversationFallback({kind:'access',messages:[user('That worked but I am still stuck')]}).status,'resolved');
assert.notEqual(supportConversationFallback({kind:'access',messages:[user('I got in. Why is the course not opening?')]}).status,'resolved','Confirmation with an unanswered question is not a complete resolution');
assert.equal(supportConversationFallback({...leadsContext,messages:[user('How do I get clients?'),assistant('Your bot works eligible leads automatically.'),user('Thanks!')]}).status,'resolved');
assert.notEqual(supportConversationFallback({...leadsContext,messages:[user('Bot stopped'),assistant('Which screen are you on?'),user('Thanks!')]}).status,'resolved');
assert.equal(supportConversationFallback({kind:'account',messages:[user('I want a human')]}).status,'open','No transfer or useful question must not mark the customer as blocking the issue');
assert.match(supportConversationFallback({kind:'account',messages:[user('cancel my subscription')]}).reply,/do not cancel/);
assert.equal(supportConversationFallback({kind:'account',messages:[{role:'operator',content:'Checking this.'},user('Any update?')]}).status,'waiting_on_customer');
const refund=supportConversationFallback({kind:'account',messages:[user('I want a refund')]});assert.match(refund.reply,/All sales are final/);assert.doesNotMatch(refund.reply,/team|review queue|escalat/i);
const duplicate=supportConversationFallback({kind:'access',messages:[user('You charged me twice and I cannot get in. I want a refund.')]});assert.match(duplicate.reply,/duplicate-charge report/);assert.doesNotMatch(duplicate.reply,/All sales are final|team|review queue/i);assert.notEqual(duplicate.status,'resolved');
const formerHandoff=supportConversationFallback({kind:'access',handedOff:true,messages:[assistant('The team will review this.'),user('Still cannot sign in with my email code in Safari')]});assert.doesNotMatch(formerHandoff.reply,/team|review queue/i);assert.notEqual(formerHandoff.status,'resolved');
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture-only';process.env.ICASH_SUPPORT_AI_MODEL='fixture-model';
try{
 let leadCalls=0;
 const generic=async()=>{leadCalls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'To get a client, focus on marketing your services clearly, networking in relevant communities, and delivering quality work. What type of service or product are you offering?',answered:false})}}]});};
 const firstClient=await replyToSupport(leadsContext,generic);assert.match(firstClient.reply,/bot finds and works eligible seller leads automatically/);assert.equal(leadCalls,0,'Known course flow cannot be replaced by generic model advice');
 assert.equal((await replyToSupport({...leadsContext,allowAI:false},generic)).reply,firstClient.reply,'Interrupted/replayed requests retain course guidance');
 for(const question of ['How do I use Take over?','How do I use my custom voice?','How do I view a new lead?']){
  const feature=await replyToSupport({...leadsContext,messages:[user(question)]},async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Fixture feature-specific answer.',answered:false})}}]}));
  assert.equal(feature.reply,'Fixture feature-specific answer.','Specific feature questions must reach course-grounded conversation, not generic onboarding');
 }
 await replyToSupport({kind:'account',messages:[user('What happens after the seller signs?')],evidence:ready},async(url,init)=>{
  const body=JSON.parse(init.body),policy=body.messages[0].content;
  assert.match(policy,/automated support/);assert.match(policy,/not asking how to market a freelance service/);assert.match(policy,/After a seller signs, the customer reviews/);assert.match(policy,/no outbound AI calls to buyers/);assert.match(policy,/Automated support chat is available without VIP/);assert.match(policy,/Checks take precedence/);
  assert.deepEqual(JSON.parse(body.messages[1].content).verifiedChecks,[],'A product how-to does not need unrelated account checks');
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Review the seller conversation, numbers and agreement in Documents, then sign if appropriate. Which step are you on?',answered:false})}}]});
 });
 const context={kind:'account',messages:[user('The bot stopped'),assistant('Which screen?'),user('The workspace, sk_live_abcdefghijkl and me@example.invalid')],evidence:[{key:'work',status:'attention',detail:'The bot is paused.',source:'fixture',observedAt:new Date().toISOString()}]};let calls=0;
 const fetcher=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(body.store,false);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);assert(init.signal);assert.match(body.messages[1].content,/Which screen/);assert(!body.messages[1].content.includes('sk_live_abcdefghijkl'));assert(!body.messages[1].content.includes('me@example.invalid'));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Your bot is paused. Are you ready to resume it from the workspace?',answered:false})}}]});};
 const response=await replyToSupport(context,fetcher);assert(response.ai);assert.match(response.reply,/paused/);assert.equal(calls,1);
 const modelReply=(reply,answered,needsTeam=false)=>async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,answered})}}]});
 for(const irrelevant of ['Test checkout credit is separate.','This is not a bank balance or refund amount.','Your sandbox payments are separate.']){
  const reply=await replyToSupport(context,modelReply(irrelevant,false));
  assert.equal(reply.ai,false);assert.doesNotMatch(reply.reply,/test checkout|sandbox|bank balance|refund amount/i);
 }
 assert.equal((await replyToSupport({...context,messages:[user('Are my test credits usable?')]},modelReply('Test credits do not fund live work.',false))).ai,true,'An explicit test-credit question can still be answered honestly');
 const complete=await replyToSupport({...leadsContext,messages:[user('What is Take over?')]},modelReply('Take over pauses new automatic work on that property so you can handle it yourself.',true));
 assert.equal(complete.status,'resolved');assert.equal(complete.reply,'Take over pauses new automatic work on that property so you can handle it yourself.');
 const unresolvedSideQuestion={kind:'account',messages:[user('The bot is not working'),assistant('I haven’t confirmed a fix.'),user('What is Take over?')],evidence:unrelatedChecks};
 const sideAnswer=await replyToSupport(unresolvedSideQuestion,modelReply('Take over pauses new automatic work on that property so you can handle it yourself.',true));
 assert.equal(sideAnswer.reply,complete.reply);assert.equal(sideAnswer.status,'open','A model answer to a side question must not close the earlier problem');
 const thanks=await replyToSupport({...unresolvedSideQuestion,messages:[...unresolvedSideQuestion.messages,assistant(sideAnswer.reply),user('Thanks')]},modelReply('You’re welcome.',true));
 assert.equal(thanks.status,'open','Thanks for a side answer is not confirmation that the original problem is fixed');
 const missing=await replyToSupport(context,modelReply('Which screen are you on?',true));assert.equal(missing.status,'open','A repeated screen question is removed and the existing issue remains open');
 const pending=await replyToSupport(context,modelReply('Please tell us the exact error on screen.',false));assert.equal(pending.status,'open');
 const staff=await replyToSupport(context,modelReply('A team member needs to review the account.',true,true));assert.equal(staff.status,'open','An invented handoff is rejected and the existing issue remains open');
 await replyToSupport({...context,allowAI:false},fetcher);assert.equal(calls,1,'Replay recovery never repeats a paid call');
 await replyToSupport({kind:'access',messages:[user('code does nothing')]},fetcher);assert.equal(calls,1,'Access recovery has no paid provider dependency');
 for(const bad of [{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'I have refunded your payment.',answered:false})}}]},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Open https://attacker.invalid',answered:false})}}]}])assert.equal((await replyToSupport(context,async()=>Response.json(bad))).ai,false);
 assert.equal((await replyToSupport(context,async()=>{throw Error('timeout');})).ai,false);

 // Card entries are not charges. Unrelated service checks must not become a billing diagnosis.
 const card={kind:'account',messages:[user('Adding a new card creates a duplicate line and returns me to the original payment method.')],evidence:[check('subscription','ok','renewal_active'),check('readiness','attention','readiness_blocked'),check('voice','attention','voice_review')]};
 const cardFallback=supportConversationFallback(card);
 assert.match(cardFallback.reply,/new card saved/);assert.equal((cardFallback.reply.match(/\?/g)??[]).length,1);
 assert.doesNotMatch(cardFallback.reply,/duplicate.charge|two charges|calling|contract|readiness|configuration/i);
 const cardReply=await replyToSupport(card,async(url,init)=>{
  const body=JSON.parse(init.body),input=JSON.parse(body.messages[1].content);
  assert.deepEqual(input.verifiedChecks.map(check=>check.key),['subscription']);
  assert.match(body.messages[0].content,/everyday words/);assert.match(body.messages[0].content,/Do not rephrase a question already asked/);
  return modelReply('The page still shows your old card. What does the button beside the new card say?',false)();
 });
 assert.equal(cardReply.ai,true);
 const followup={...card,messages:[...card.messages,assistant(cardReply.reply),user('It says Make default. I already tried that and it switches back.') ]};
 const repeated=await replyToSupport(followup,modelReply('What does the button beside the new card say?',false));
 assert.equal(repeated.ai,false);assert.equal(repeated.status,'open');assert.doesNotMatch(repeated.reply,/\?/);
 assert.doesNotMatch(repeated.reply,/Make default|exact message|error text|calling|readiness|configuration/i);
 for(const badReply of [
  'Your workspace readiness is blocked. Calling and contract configuration might indirectly affect billing updates. What error text appears?',
  'What error appears? Which card are you adding?',
  Array(101).fill('detail').join(' '),
 ])assert.equal((await replyToSupport(card,modelReply(badReply,false))).ai,false);

 const described={kind:'account',messages:[user('The bot stopped'),{role:'operator',content:'What is the exact message on your screen?'},user('No error message appears. It just returns to the same page.')],evidence:[]};
 const repeatedError=await replyToSupport(described,modelReply('What error text is shown?',false));
 assert.equal(repeatedError.ai,false);assert.doesNotMatch(repeatedError.reply,/what (?:exact )?(?:error|message)|which screen/i);
 assert.notEqual(repeatedError.status,'resolved');
 const older=[user('The bot stopped'),assistant('What message is shown?'),...Array.from({length:17},()=>user('Still checking')),user('No message appears')];
 await replyToSupport({kind:'account',messages:older},async(url,init)=>{
  const input=JSON.parse(JSON.parse(init.body).messages[1].content);
  assert.equal(input.conversation.length,20);assert(input.alreadyAsked.includes('What message is shown?'));
  return modelReply('I can’t confirm why the page closes from these checks.',false)();
 });
 assert.match(supportConversationFallback({kind:'account',messages:[user('You charged me twice'),assistant('What dates and amounts appear for the two charges?'),user('Cancel my subscription')]}).reply,/Chat messages alone do not cancel/,'A prior charge issue must not override a new cancellation request');
}finally{process.env=env;}
console.log('PASS support conversations: multi-turn missing details, resolution, continued automatic troubleshooting, cancellation boundaries, redaction, bounded structured AI, provider failure and replay fallback; no real provider requests.');
