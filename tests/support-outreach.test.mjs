import assert from 'node:assert/strict';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const facts={screened:25,outboundProperties:25,inboundProperties:0,contactProperties:7,textsSent:11,textsDelivered:6,textReplies:0,callsStarted:0,callsBudgetHeld:25,progress:{status:'budget_reached',remainingCents:6,limitCents:500,spentCents:494}};
const evidence=[{key:'outreach',source:'fixture',observedAt:new Date().toISOString(),...supportOutreachEvidence(facts)}];
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;
const forbidden=async()=>{calls++;throw Error('Known account evidence must not need a model call');};
try{
 for(const question of ['Why are the texts not delivering','Why are my messages not delivered?','Why have sellers not received my texts?']){
  const response=await replyToSupport({kind:'account',messages:[user('Calls are waiting for spending allowance'),user(question)],evidence:[{...evidence[0],...supportOutreachEvidence({...facts,textsSent:3,textsDelivered:0})}]},forbidden);
  assert.equal(response.status,'open');assert.equal(response.ai,false);
  assert.match(response.reply,/3 texts were accepted for sending/);assert.match(response.reply,/none has a delivery confirmation/);
  assert.doesNotMatch(response.reply,/Calls are waiting|credit|balance|spending|Course|delivered successfully/i);
 }
 const deliveryUnknown=await replyToSupport({kind:'account',messages:[user('Why are texts not delivering?')],evidence:[]},forbidden);
 assert.match(deliveryUnknown.reply,/can’t verify text delivery/);assert.doesNotMatch(deliveryUnknown.reply,/credit|running bot/i);
 const settling=await replyToSupport({kind:'account',messages:[user('Calls not starting')],evidence:[{...evidence[0],...supportOutreachEvidence({...facts,progress:{...facts.progress,status:'settling'}})}]},forbidden);
 assert.match(settling.reply,/earlier work costs to be confirmed/);assert.doesNotMatch(settling.reply,/used up|nearly used up/);
 // Exact customer wording must use the real outreach evidence on the first turn.
 for(const question of ["hi my bot isn't making any calls or texts and it's been running all day",'my bot isn’t making calls','my bot isnt making any calls','It does not make calls or send texts','It has not called anyone','It hasn’t been calling sellers','No calls are being made','Why are calls not starting?',"I'm just trying to figure out why its not making calls or texts"]){
  const response=await replyToSupport({kind:'account',messages:[user(question)],evidence:[{...evidence[0],...supportOutreachEvidence({...facts,callsStarted:4,progress:{...facts.progress,status:'ready',remainingCents:121}})}]},forbidden);
  assert.equal(response.status,'open');assert.equal(response.ai,false,question);
  assert.match(response.reply,/4 recorded call attempts/);assert.match(response.reply,/11 texts \(6 delivered\) so far/);assert.match(response.reply,/saved credit hold/);assert.match(response.reply,/haven’t confirmed whether that hold still blocks new calls/);
  assert.doesNotMatch(response.reply,/test|sandbox|bank balance|refund|What were you trying|\?|tap Texts|used up/i);
  if(question.includes('all day'))assert.match(response.reply,/aren’t limited to today/);
 }
 const messages=[user('My bot is not showing seller info or starting conversations.'),assistant('What does your bot status button say?'),user('Ready'),assistant('Do you have credit?'),user('I have $5.06 in credits')];
 let response=await replyToSupport({kind:'account',messages,evidence},forbidden);
 assert.equal(response.status,'open');assert.match(response.reply,/7 properties/);assert.match(response.reply,/11 texts \(6 delivered\)/);assert.match(response.reply,/no text replies/);assert.match(response.reply,/Calls are waiting/);assert.doesNotMatch(response.reply,/\?|keep.*running|rewatch|fixed|resolved/i);
 messages.push(assistant(response.reply),user('Are these cold leads or motivated sellers?'));
 response=await replyToSupport({kind:'account',messages,evidence},forbidden);
 assert.equal(response.status,'open');assert.match(response.reply,/researched prospects/);assert.match(response.reply,/not necessarily requested an offer/);
 messages.push(assistant(response.reply),user('I still need help'));
 response=await replyToSupport({kind:'account',messages,evidence},forbidden);
 assert.equal(response.status,'open');assert.match(response.reply,/7 properties/);assert.doesNotMatch(response.reply,/open a property|What.*status|rewatch/);assert.match(response.reply,/displaying correctly/);
 messages.push(assistant(response.reply),user('I want a human'));
 response=await replyToSupport({kind:'account',messages,evidence},forbidden);
 assert.equal(response.status,'open');assert.match(response.reply,/11 texts/);assert.doesNotMatch(response.reply,/What is still happening|handoff|team/i);
 const unknown=await replyToSupport({kind:'account',messages:[user('No seller details or conversations')],evidence:[]},forbidden);
 assert.equal(unknown.status,'open');assert.match(unknown.reply,/can’t verify/);
 for(const bad of [{...facts,textsDelivered:12},{...facts,contactProperties:26},{...facts,textsSent:'11'},{...facts,callsStarted:-1}])assert.throws(()=>supportOutreachEvidence(bad));
 const paused=await replyToSupport({kind:'account',messages:[user('No seller info')],evidence:[...evidence,{key:'work',code:'paused',status:'attention',detail:'Paused',source:'fixture',observedAt:new Date().toISOString()}]},forbidden);
 assert.match(paused.reply,/bot is paused/);assert.doesNotMatch(paused.reply,/nearly used up/);
 const pacing=[{...evidence[0],...supportOutreachEvidence({...facts,progress:{...facts.progress,status:'paced'}})}];
 const legacyHold=(await replyToSupport({kind:'account',messages:[user('Calls not starting')],evidence:pacing},forbidden)).reply;
 assert.match(legacyHold,/saved credit hold/);assert.doesNotMatch(legacyHold,/next spending allowance|protected|kept for replies|spending limit/);
 const currentProgress={status:'ready',spendingMode:'available_balance',fundedBaselineCents:25000,remainingCents:13371,pendingCents:7894,spentCents:3735};
 const current=supportOutreachEvidence({...facts,progress:currentProgress});
 assert.equal(current.outreach.progress.limitCents,undefined);assert.equal(current.outreach.progress.remainingCents,13371);
 const currentReply=(await replyToSupport({kind:'account',messages:[user('Calls not starting')],evidence:[{...evidence[0],...current}]},forbidden)).reply;
 assert.match(currentReply,/haven’t confirmed whether that hold still blocks new calls/);assert.doesNotMatch(currentReply,/allowance|protected|kept for replies|spending limit/);
 assert.throws(()=>supportOutreachEvidence({...facts,progress:{...currentProgress,pendingCents:-1}}));
 const confirmed=await replyToSupport({kind:'account',messages:[...messages,user('That worked, all fixed!')],evidence},forbidden);
 assert.equal(confirmed.status,'resolved');
 assert.equal(calls,0);
}finally{process.env=env;}
console.log('PASS support outreach: saved contacts, real receipts, budget holds, cold prospects, unresolved follow-ups, no repeated steps, unknown evidence and customer confirmation; no provider calls.');
