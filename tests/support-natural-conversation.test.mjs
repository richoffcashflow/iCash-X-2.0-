// Anonymized replays of observed customer wording. Offline only: no sends or paid AI calls.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {currentSupportIssue} from '../lib/support-reply-style.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const facts={screened:12,outboundProperties:12,inboundProperties:0,contactProperties:8,textsSent:1,textsDelivered:1,textReplies:0,callsStarted:0,callsBudgetHeld:0,progress:null};
const evidence=[{key:'outreach',source:'fixture',observedAt:'2026-10-26T14:00:00Z',...supportOutreachEvidence(facts)},{key:'work',source:'fixture',observedAt:'2026-10-26T14:00:00Z',status:'ok',code:'not_paused',detail:'Your bot is not paused.'}];
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let paidCalls=0;
const noModel=async()=>{paidCalls++;throw Error('This observed case must work locally');};
const model=reply=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,answered:false})}}]});
try{
 for(const question of ['How often does these seller leads come in?','How often do these seller leads come in?','When do you think the next set of seller leads will come in?','When will my next lead arrive?']){
  const answer=await replyToSupport({kind:'account',messages:[user(question)],evidence},noModel);
  assert.match(answer.reply,/fixed schedule/);assert.match(answer.reply,/can’t predict/);
  assert.doesNotMatch(answer.reply,/upload|listings|Course|credits|\?/i);assert.equal(answer.status,'resolved');
 }
 for(const question of ['Does the Ai bot run everyday 24/7?','When will the Ai bot call or text the seller?','Will the Ai bot call or text the seller automatically, when the lead comes in?']){
  const answer=await replyToSupport({kind:'account',messages:[user(question)],evidence},noModel);
  assert.match(answer.reply,/9 AM to 9 PM/);assert.match(answer.reply,/Central Time/);
  assert.doesNotMatch(answer.reply,/as soon as|immediately|all day and night|\?/i);
 }
 const waiting=await replyToSupport({kind:'account',messages:[user('What does it mean Waiting for the next task')],evidence},noModel);
 assert.match(waiting.reply,/no task is running/);assert.doesNotMatch(waiting.reply,/finished|normal pause|start soon/);
 const timing=[user('How often do seller leads come in?'),assistant('Leads don’t arrive on a fixed schedule.'),user('Could be anytime')];
 assert.match((await replyToSupport({kind:'account',messages:timing,evidence},noModel)).reply,/can’t predict/);

 const original='My bot is running but it has not sent any messages.';
 const messages=[user(original)];
 for(const question of [null,'It’s active','73 leads. 42 matches','Nothing','It don’t show any of that','When will the bot work for me','Ok because I want the bot to do the work','Ok']){
  if(question)messages.push(user(question));
  const answer=await replyToSupport({kind:'account',messages,evidence},noModel);
  assert.equal(answer.ai,false);assert.equal(answer.status,'open');
  assert.doesNotMatch(answer.reply,/wait a few hours|start.*soon|permission|Start outreach|What were you trying|\?/i);
  if(question==='It’s active')assert.equal(currentSupportIssue(messages),original);
  messages.push(assistant(answer.reply));
 }
 messages.push(user('I sent the text. It wasn’t the bot'));
 const correction=await replyToSupport({kind:'account',messages,evidence},noModel);
 assert.match(correction.reply,/you sent yourself/);assert.match(correction.reply,/don’t separate manual messages/);
 assert.doesNotMatch(correction.reply,/bot (?:sent|has sent)|\?/i);
 for(const bad of ['Look in Settings for Contact permissions and turn it on.','Do you see Start outreach or a similar button?','Look for Bot Contact in Communication Settings.']){
  const answer=await replyToSupport({kind:'account',messages:[user(original),assistant(bad),user('Where is that at')],evidence},noModel);
  assert.match(answer.reply,/earlier instruction was wrong/);assert.doesNotMatch(answer.reply,/\?/);
  assert.equal(answer.status,'open');
  const cancel=await replyToSupport({kind:'account',messages:[user(original),assistant(bad),user('I can’t find contact permissions. Cancel my subscription.')],evidence},noModel);
  assert.match(cancel.reply,/Cancel subscription/);assert.doesNotMatch(cancel.reply,/earlier instruction/);
 }
 for(const topic of ['My new credit card won’t save.','The photos are blank.','Where is the course?','Cancel my subscription.']){
  const context={kind:'account',messages:[...messages,user(topic)],evidence};
  assert.equal(currentSupportIssue(context.messages),topic);
  assert.doesNotMatch(supportConversationFallback(context).reply,/recorded call|automatic outreach|manual messages/);
 }
 const unknown={kind:'account',messages:[user('The activity panel freezes.')],evidence:[]};
 for(const bad of ['Look for Bot Contact in Settings.','Wait a few hours and try again.','It should start messaging leads soon.','It’s a normal pause.','I’m checking the account now.']){
  const answer=await replyToSupport(unknown,async()=>model(bad));
  assert.equal(answer.ai,false,bad);assert.notEqual(answer.status,'resolved');
 }
 let inspected=false;
 await replyToSupport({kind:'account',messages:[user('The activity panel freezes.'),assistant('Which browser are you using?'),user('Still the same.')],evidence},async(_url,init)=>{
  inspected=true;const input=JSON.parse(JSON.parse(init.body).messages[1].content);
  assert.equal(input.currentIssue,'The activity panel freezes.');
  return model('I can’t confirm why the activity panel freezes yet.');
 });
 assert(inspected);assert.equal(paidCalls,0);
}finally{process.env=env;}
console.log('PASS natural support: lead timing, honest hours, short follow-ups, invented controls, manual-message corrections, new topics and unsupported promises; no paid calls.');
