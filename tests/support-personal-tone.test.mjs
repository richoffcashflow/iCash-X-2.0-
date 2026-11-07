// Fictional offline conversations. No customer sends, paid model calls or account writes.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportReplyStyle} from '../lib/support-reply-style.ts';
import {supportCurrentStepReply} from '../lib/support-current-step.ts';
const user=content=>({role:'user',content}),agent=content=>({role:'assistant',content});
const words=text=>text.trim().split(/\s+/).length;
let cases=0,modelCalls=0;
const noModel=async()=>{modelCalls++;throw Error('Known replies must stay offline');};
async function reply(messages,extra={}){
 cases++;
 const context={kind:'account',messages,...extra};
 const answer=await replyToSupport(context,noModel);
 assert.deepEqual(answer,supportConversationFallback(context),'Recovery and regular delivery use identical concise copy');
 return answer;
}
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
try{
 for(const kind of ['account','access']){
  const history=[user('What is outreach?'),agent('Outreach means your bot contacting sellers by call or text.')];
  for(const [q,expected] of [['OK','Got it.'],['Thanks','You’re welcome.']]){
   const r=await reply([...history,user(q)],{kind});
   assert.equal(r.reply,expected);assert.equal(r.status,'resolved');assert.equal(r.ai,false);
  }
  const r=await reply([user('The screen is broken'),agent('I haven’t confirmed a fix yet.'),user('OK')],{kind});
  assert.equal(r.reply,'Got it.');assert.equal(r.status,'open','A brief acknowledgment does not resolve an earlier failure');
 }
 const signingQuestion='How will I know when I have a contract to sign myself?';
 const full=await reply([user(signingQuestion)]);
 assert.match(full.reply,/every required seller signs first.*Review & sign/);
 assert.match(full.reply,/separately authorized that exact agreement/);
 assert.match(full.reply,/verbal yes is not a signature/);
 const signingHistory=[user(signingQuestion),agent(full.reply)];
 for(const q of ['I have to wait until they do it first?','They sign first?','Do I have to wait?']){
  const r=await reply([...signingHistory,user(q)]);
  assert.match(r.reply,/^Yes, every required seller signs first/);
  assert.match(r.reply,/Agreements → Review & sign.*review the exact document/);
  assert(words(r.reply)<=25);assert(words(r.reply)<words(full.reply));
  assert.equal(r.status,full.status);assert.doesNotMatch(r.reply,/already signed|I signed|I’ll|\?/);
 }
 const nameQuestion='Seller 1 legal name is mine or the property owner’s?';
 const nameAnswer=await reply([user(nameQuestion)]);
 for(const q of ['Do I put it manually?','Can I enter it myself?']){
  const r=await reply([user(nameQuestion),agent(nameAnswer.reply),user(q)]);
  assert.match(r.reply,/^Yes\. Enter or correct it in Send for signatures/);
  assert.match(r.reply,/property owner’s legal name.*every required seller/);
  assert(words(r.reply)<=30);assert(words(r.reply)<words(nameAnswer.reply));
  assert.equal(r.status,nameAnswer.status);
 }
 for(const [problem,expected] of [
  ['My sign-in access is still blocked',/unresolved purchase or sign-in access/],
  ['The bot is not working and no calls are happening',/bot’s work is delayed or missing/],
  ['There is a duplicate payment problem',/payment or credit issue/],
  ['My contract is still blocked',/agreement issue/],
 ]){
  const history=[user(problem),agent('Your case is still in management review.')];
  const first=await reply([...history,user('Any update?')],{handedOff:true});
  assert.match(first.reply,expected);assert.match(first.reply,/don’t have a confirmed fix or completion time/);
  assert.equal((first.reply.match(/management review/g)??[]).length,1);
  assert(words(first.reply)<=32);assert.equal(first.status,'open');assert.equal(first.managementReview,true);
  const next=await reply([...history,user('Any update?'),agent(first.reply),user('Why?')],{handedOff:true});
  assert.match(next.reply,expected);assert.equal(next.status,'open');assert.equal(next.managementReview,true);
 }
 const contact=await reply([user('My bot is not working'),agent('Your case is still in management review.'),user('Will I be contacted?')],{handedOff:true});
 assert.match(contact.reply,/Management can reply in this conversation/);
 assert.match(contact.reply,/can’t promise a phone call or response time/);
 assert.equal((contact.reply.match(/management review/g)??[]).length,1);
 assert.doesNotMatch(contact.reply,/will contact|will call|within|I understand your frustration/i);
 // Do not force short answers on a new topic or erase consequential qualifications.
 assert.equal(supportCurrentStepReply({kind:'account',messages:[...signingHistory,user('Can I enter it myself?')]}),null);
 const failure=await reply([...signingHistory,user('The Review button is not working')],{allowAI:false});
 assert.notEqual(failure.status,'resolved');assert.notEqual(failure.status,'closed');assert.doesNotMatch(failure.reply,/^Yes, every required seller/);
 const mixed=await reply([user('Voicemails are counted as seller responses and credits were deducted. I want a refund and human support.')]);
 for(const expected of [/not a seller response/,/credits/,/All sales are final/,/no live transfer/i])assert.match(mixed.reply,expected);
 assert.equal(mixed.status,'open');
 // Repetition alone must not turn routine product guidance into management work.
 for(const question of ['What is Take over?','Seller 1 legal name is mine or the property owner’s?']){
  const first=await reply([user(question)]);
  const repeated=await reply([user(question),agent(first.reply),user(question.replace(/\?$/,' again?'))]);
  assert.equal(repeated.managementReview,undefined,'An answered feature question does not need escalation');
  assert.doesNotMatch(repeated.reply,/management review/);
  const alreadyReviewed=await reply([user('My bot is not working'),agent('Your case is in management review.'),user(question)],{handedOff:true});
  assert.equal(alreadyReviewed.managementReview,undefined);assert.doesNotMatch(alreadyReviewed.reply,/management review/);
  assert.equal(alreadyReviewed.status,'open','Answering a routine side question does not close the real earlier issue');
 }
 // Real failures must retain review, including wording outside a narrow failure list.
 for(const [kind,questions] of [
  ['account',['How do I return to bot?','Still broken']],
  ['account',['How do I return to bot?','Still nothing']],
  ['account',['How do I return to bot?','Same problem']],
  ['account',['The new card doesn’t save.','It says Default','Still the same']],
  ['account',['The old card is selected after I update the payment method.','It says Default','Still the same']],
  ['account',['The calls have no audio.','Still the same']],
  ['account',['The code is expired.','It says Default','Still the same']],
  ['account',['I can’t access the buyer network.','I still can’t access the buyer network.']],
  ['account',['Return to bot does nothing.','Still nothing after Return to bot.']],
  ['account',['My bot stopped working on weekends.','My bot is still stopped on weekends.']],
  ['account',['I press Call but the bot has no audio.','I still press Call but the bot has no audio.']],
 ]){
  const messages=[];let result;
  for(const q of questions){messages.push(user(q));result=await reply(messages,{kind,allowAI:false});messages.push(agent(result.reply));}
  assert.equal(result.managementReview,true,questions.join(' / '));assert.equal(result.status,'open');
  assert.equal(result.routineGuidance,undefined);
 }
 assert.equal(modelCalls,0);
 let inspected=false;
 const modeled=await replyToSupport({kind:'account',messages:[user('The activity panel freezes.')],evidence:[]},async(_url,init)=>{
  inspected=true;const body=JSON.parse(init.body),system=body.messages[0].content;
  assert(system.includes(supportReplyStyle));assert.match(system,/Default to one or two short sentences/);
  assert.match(system,/Personal means noticing the detail that matters/);
  assert.match(system,/Do not invent feelings, familiarity, personal experience or promises/);
  assert.match(system,/Use more detail only when it is needed to answer every part/);
  assert.match(system,/short follow-up should answer just the new point/);
  assert.match(system,/you have no execution tools/);assert.match(system,/Never invent a repair/);
  assert.equal(body.tools,undefined);assert.equal(body.store,false);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Does it freeze when you open the panel or after it loads?',answered:false})}}]});
 });
 assert(inspected);assert.equal(modeled.ai,true);assert.equal(modeled.status,'waiting_on_customer');
 assert.equal(modeled.reply,'Does it freeze when you open the panel or after it loads?');
}finally{process.env=env;}
console.log(`PASS personal support tone: ${cases} offline replies, concise case-aware follow-ups, full multi-part answers and shared prompt boundaries.`);
