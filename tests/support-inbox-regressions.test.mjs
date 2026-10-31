// Anonymized October 31 inbox replays. No sends, account mutations or paid AI.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
import {currentSupportIssue,removeRepeatedSupportQuestions,supportSafetyOnly} from '../lib/support-reply-style.ts';
import {currentAccessConversation} from '../lib/support-access-topic.ts';
import {supportCodeDelivery} from '../lib/support-code-delivery.ts';
import {supportLeadImportQuestion} from '../lib/support-lead-policy.ts';
import {supportQualityReport} from '../lib/support-quality.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const check=(key,code,status,detail)=>({key,code,status,detail,source:'fixture',observedAt:'2026-10-31T16:00:00Z'});
const evidence=[
 {...check('outreach','outreach_checked','ok','Recorded activity'),...supportOutreachEvidence({screened:12,outboundProperties:12,inboundProperties:0,contactProperties:0,textsSent:7,textsDelivered:6,textReplies:0,callsStarted:3,callsBudgetHeld:2,progress:null})},
 check('work','not_paused','ok','Your bot is not paused.'),
 check('voice','voice_service_held','attention','The latest saved call did not pass its calling checks. This does not confirm the next call is ready.'),
];
const savedEnv={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline-fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let calls=0;const noModel=async()=>{calls++;throw Error('This reply must work offline');};
const ask=(messages,kind='account',extra={})=>replyToSupport({kind,messages,evidence,...extra},noModel);
try{
 for(const kind of ['account','access']){
  for(const question of ['Can I upload my own leads?','How do I import a CSV?','Can VIP users bring their own leads?','I cannot add a listing.','Your site is not allowing me to put in my own leads.','Can I enter properties myself?']){
   const answer=await ask([user(question)],kind);
   assert.match(answer.reply,/cannot add, upload or import their own leads/);assert.match(answer.reply,/automatically/);
   assert.doesNotMatch(answer.reply,/Test your bot|demo|Add money|sign.in|\?/i);assert.equal(answer.status,'resolved');
  }
  const mixed=await ask([user('Your site is not allowing me to put in my own leads. Also none of these leads have a listed number for AI to call them')],kind);
  assert.match(mixed.reply,/cannot add, upload or import/);assert.match(mixed.reply,/cannot be called or texted/);assert.equal(mixed.status,'open');
  for(const question of ['Cancel my subscription; I cannot upload my leads.','I was charged twice and cannot upload leads.']){
   const answer=await ask([user(question)],kind,{allowAI:false});assert.doesNotMatch(answer.reply,/cannot add, upload or import/);assert.notEqual(answer.status,'resolved');
  }
 }
 for(const question of ['How do I upload photos to a property?','How do I upload my receipt?','Where do I download the contract?'])assert.equal(supportLeadImportQuestion(question),false);
 for(const question of ['none of these leads have contact information','No numbers are listed on any of them','When I click text it says no number','The contact number is not saved to the property']){
  const answer=await ask([user(question)]);assert.equal(answer.status,'open');assert.match(answer.reply,/cannot be called or texted/);assert.match(answer.reply,/no saved owner details/);assert.doesNotMatch(answer.reply,/recorded call attempts|pay|upgrade|sign.in/i);
 }
 for(const question of ['Do I have to be VIP to get contacts?','Okay. So I need to be VIP to get a deal?']){
  const answer=await ask([user(question)]);assert.match(answer.reply,/VIP is not required/);assert.doesNotMatch(answer.reply,/faster support|upgrade now/i);
 }
 const original='Why does my bot still say Waiting for next task?';
 const history=[user(original),assistant('What exact message do you see now, and which screen is it on?')];
 for(const question of ['My bot is not working','Thanks for trying what?','So how and when will it start back up?','im signed in','?']){
  history.push(user(question));const answer=await ask(history);
  assert.equal(answer.status,'open');assert.match(answer.reply,/recorded call|calling checks/);assert.doesNotMatch(answer.reply,/sign.in step|password|Thanks for trying|What are you trying|\?/i);
  history.push(assistant(answer.reply));
 }
 assert.equal(currentSupportIssue(history),'My bot is not working');
 const shifted=await ask([...history,user('Where is the course?')]);assert.match(shifted.reply,/Open Course/);assert.doesNotMatch(shifted.reply,/calling checks|recorded call/);
 const stats=await ask([user('Check my stats')]);assert.match(stats.reply,/3 recorded call attempts and 7 texts \(6 delivered\)/);assert.doesNotMatch(stats.reply,/today|all delivered/);
 const voicemails=[user('What should I do now when the seller replies are voicemail or a business service')];
 const vm=await ask(voicemails);assert.match(vm.reply,/not a seller response/);assert.match(vm.reply,/without leaving a message/);
 const next=await ask([...voicemails,assistant(vm.reply),user('So should I do now')]);assert.equal(next.reply,vm.reply);
 const nothing=await ask([...voicemails,assistant(vm.reply),user('So I have nothing to do right')]);assert.match(nothing.reply,/still need to review/);assert.equal(nothing.status,'open');
 for(const question of ['How long does it take the bot to reach out to leads once they are found?','When will bot start making calls?']){
  const answer=await ask([user(question)]);assert.match(answer.reply,/9 AM to 9 PM/);assert.doesNotMatch(answer.reply,/next lead will appear/);
 }
 for(const question of ['Okay thank you I will','Thanks','Ok']){
  const answer=await ask([user('My bot is not working'),assistant('The issue remains open.'),user(question)]);
  assert.equal(answer.status,'open');assert.match(answer.reply,/You’re welcome|Understood/);assert.doesNotMatch(answer.reply,/confirmed answer|What are you trying|\?/);
 }
 assert.equal(supportSafetyOnly('Thanks for trying that.  Leave out passwords and sign-in codes.'),true);
 const stripped=removeRepeatedSupportQuestions('Thanks for trying that. What exact message do you see now, and which screen is it on? Leave out passwords and sign-in codes.',[assistant('What exact message is shown?')]);
 assert.doesNotMatch(stripped,/Thanks for trying|passwords|what are you trying/i);

 const investigation={checked:true,email:'configured',phone:'configured'};
 const access=[user('I paid but code never arrived'),assistant('Are you requesting the code by email or text?'),user('Both')];
 let answer=await ask(access,'access',{accessInvestigation:investigation});
 assert.doesNotMatch(answer.reply,/whether.*email or text|enter.*code|one fresh|Text me a code.*Does a box/);
 const details=[...access,assistant('The code requests haven’t restored access. What are the payment date and amount on your receipt?'),user('10/29/26 of 50$')];
 assert(currentAccessConversation(details).length>0);answer=await ask(details,'access',{accessInvestigation:investigation});
 assert.doesNotMatch(answer.reply,/What are you trying|payment date and amount|enter the newest code/);assert.notEqual(answer.status,'resolved');
 const device=[user('When I request code for phone or email I receive nothing'),assistant('Which device and browser are you using?'),user('I’m using safari on an iPhone')];
 assert.equal(supportCodeDelivery(currentAccessConversation(device)),'missing');
 answer=await ask(device,'access',{accessInvestigation:investigation});assert.doesNotMatch(answer.reply,/enter the newest code|Which device|What are you trying/);assert.notEqual(answer.status,'resolved');
 const product=await ask([...device,user('Can I upload my own leads?')],'access');assert.match(product.reply,/cannot add, upload or import/);assert.doesNotMatch(product.reply,/code|Safari/);
 assert.equal(currentAccessConversation([...device,user('I am signed in')]).length,0);

 for(const reply of ['You can upload your own leads as a CSV.','Open Add lead in your workspace.']){
  const rejected=await replyToSupport({kind:'account',messages:[user('What features can I customize?')]},async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,answered:true})}}]}));
  assert.equal(rejected.ai,false);assert.notEqual(rejected.status,'resolved');
 }
 const quality=supportQualityReport([{id:'fixture',kind:'account',subject:'Bot status',status:'open',updated_at:'2026-10-31T16:00:00Z',messages:[user(original),assistant('Thanks for trying that. Leave out passwords and sign-in codes.')].map((m,i)=>({...m,created_at:`2026-10-31T16:00:0${i}Z`}))}],new Date('2026-10-31T16:01:00Z'));
 assert(quality.cases[0].flags.some(f=>f.code==='empty'));assert(quality.cases[0].flags.some(f=>f.code==='mismatch'));
 assert.equal(calls,0);
}finally{process.env=savedEnv;}
console.log('PASS observed inbox regressions: customer lead policy, missing contacts, VIP, bot status, follow-ups, acknowledgments, voicemail, timing, guest code delivery and quality signals; offline only.');
