// Anonymized support regressions. No customer writes, external models or providers.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportIdentityReply} from '../lib/support-checkout.ts';
import {supportLeadImportQuestion} from '../lib/support-lead-policy.ts';
import {classifySupportCoaching} from '../lib/support-coaching.ts';
import {supportProductConflict} from '../lib/support-product-conflicts.ts';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const evidence=[{key:'outreach',source:'offline',observedAt:'2026-11-05T00:00:00Z',...supportOutreachEvidence({screened:8,outboundProperties:8,inboundProperties:0,contactProperties:6,textsSent:5,textsDelivered:4,textReplies:0,callsStarted:2,callsBudgetHeld:0,progress:null})}];
const previous={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
let requests=0,checks=0;
const noModel=async()=>{requests++;throw Error('Unexpected model call');};
async function reply(question,history=[],kind='account'){
 checks++;return replyToSupport({kind,messages:[...history,user(question)],evidence,contactKnown:kind==='access'},noModel);
}
try{
 for(const q of ['Do you know why no one is answering the calls?','If I pay $10 do you know how many leads I can get?','Do you see why I cannot review the seller conversation?'])assert.equal(supportIdentityReply({kind:'account',messages:[user(q)]}),null,q);
 for(const kind of ['account','access'])assert.match(supportIdentityReply({kind,contactKnown:true,messages:[user('You already have my email')]}),/already attached|connected to your signed-in account/);
 for(const q of ['Why doesn’t adding money guarantee a lead?','If I add $10 how many leads can I get?'])assert.equal(supportLeadImportQuestion(q),false,q);
 assert.equal(supportLeadImportQuestion('How do I add my own leads?'),true);
 for(const q of ['When do credits get used before or AFTER selecting a lead?','So I won’t spend credits UNTIL I select a lead correct?']){
  const r=await reply(q);assert.match(r.reply,/before you select/);assert.match(r.reply,/Pause bot/);assert.doesNotMatch(r.reply,/0 recorded|upload|VIP/);
 }
 for(const q of ['How many leads can the bot find?','How many leads will I have if I put 10 dollars in?','If I pay $10 do you know how many leads I can get?']){
  const r=await reply(q);assert.match(r.reply,/no fixed|isn’t a fixed/);assert.doesNotMatch(r.reply,/email again|upload|don’t have a confirmed answer/);
 }
 const guarantee=await reply('Why doesn’t adding money guarantee a lead?');assert.match(guarantee.reply,/work performed/);assert.doesNotMatch(guarantee.reply,/import|upload/);
 const budget='How much should I invest to get AI bot going?';assert.equal(classifySupportCoaching(budget).kind,'support');assert.match((await reply(budget)).reply,/Add money/);
 assert.equal(classifySupportCoaching('How much should I offer on this property?').kind,'coaching');
 for(const q of ['Do we choose which states leads come from?','Can I select different markets?'])assert.match((await reply(q)).reply,/markets automatically/);
 for(const q of ['When I click the property it says sending messages pauses the bot. Will it start tomorrow morning?','If I take over will the bot still find a buyer?','Mine says return to bot and I’m in control of this lead']){
  const r=await reply(q);assert.match(r.reply,/until you choose Return to bot/);assert.match(r.reply,/does not resume/);assert.equal(r.status,'open');
 }
 assert.match((await reply('If I take over will the bot still find a buyer?')).reply,/signed purchase agreement/);
 assert.equal(supportProductConflict('The bot will resume automatically tomorrow morning.','Sending messages pauses the bot'),true);
 assert.equal(supportProductConflict('The bot does not resume until you choose Return to bot.','Sending messages pauses the bot'),false);
 for(const q of ['The purchase agreement isn’t working right for me','My agreement is blank','I cannot send the contract']){
  const r=await reply(q);assert.match(r.reply,/Which step fails/);assert.doesNotMatch(r.reply,/Seller is ready|renew subscription/);assert.equal(r.status,'open');
 }
 assert.match((await reply('I want the bot to auto fill the agreement form')).reply,/fill empty fields/);
 assert.match((await reply('I can’t review the seller conversation to document the resolution box')).reply,/Open conversation/);
 const multi='My dashboard reports voicemail greetings as seller responses. Why are all leads in one city and can I select markets? What credits were deducted for unanswered calls and texts? What is the refund policy? Please escalate to a human representative.';
 const complaint=await reply(multi);for(const p of [/not a seller response/,/markets automatically/,/itemized costs/,/All sales are final/,/remain open/])assert.match(complaint.reply,p);assert.equal(complaint.status,'open');
 const continuation=await reply('My concerns are not limited to your refund policy. Why are voicemail greetings classified as seller responses? What credits were deducted?', [user(multi),assistant('All sales are final.')]);assert.match(continuation.reply,/itemized costs/);assert.doesNotMatch(continuation.reply,/tell me what happened|All sales are final/);
 for(const q of ['Do you know why no one is answering the calls?','I’ve been reaching out and no one is responding','Nobody replied, what do I do?']){
  const r=await reply(q);assert.match(r.reply,/calls?/i.test(q)?/2 call attempts.*do not show how many people answered/:/4 texts.*0 seller text replies/);assert.doesNotMatch(r.reply,/email again|why new outreach hasn’t started|messages are displaying/);assert.equal(r.status,'open');
 }
 const short=await reply('The bot is cutting the call short');assert.match(short.reply,/whether the call ended or playback failed/);assert.doesNotMatch(short.reply,/normal|seller.*not interested/);
 for(const q of ['My opportunity search isn’t populating','Refresh opportunity search results'])assert.match((await reply(q)).reply,/All activity/);
 assert.match((await reply('What is the name of the sign in page',[], 'access')).reply,/https:\/\/www\.geticashx\.com\//);
 assert.match((await reply('I paid but haven’t received anything',[], 'access')).reply,/receipt, the sign-in code, or access/);
 const accessHistory=[user('I paid but my code has not arrived'),assistant('Your access issue remains open.')];
 for(const q of ['Okay remains open until when?','Did I get scammed?']){
  const r=await reply(q,accessHistory,'access');assert.match(r.reply,/access issue is still unresolved/);assert.match(r.reply,/Don’t pay again/);assert.equal(r.status,'open');
 }
 // New substantive topics and explicit cancellation remain independent.
 for(const q of ['Where is the course?','Cancel my subscription']){
  const r=await reply(q,[user(multi),assistant(complaint.reply)]);assert.doesNotMatch(r.reply,/voicemail|itemized costs/);
 }
 const cancellation=await reply('I took over a lead. Cancel my subscription.');assert.match(cancellation.reply,/Cancel subscription/);
 assert.match((await reply('How does the title company process work?')).reply,/Closing section/);
 assert.match((await reply('Do I also pay for buyer leads?')).reply,/also use work credits/);
 assert.match((await reply('Can the assignment fee be more then 10k')).reply,/not a universal maximum/);
 assert.match((await reply('Give me an example or is the assignment fee based off the ARV because what if there was a $400,000 ARV')).reply,/\$20,000 default/);
 assert.match((await reply('Will it show us the potential assignment fee before we close the deal?')).reply,/Offer calculation/);
 assert.match((await reply('Does AI present buyers that have different prices they are willing to pay for assignment fees?')).reply,/Buyers section/);
 assert.match((await reply('How to change bot to female voice')).reply,/does not have a male\/female voice selector/);
 assert.match((await reply('Return to bot is not working')).reply,/problem remains unresolved/);
 assert.match((await reply('I returned to the bot but the agreement is blank')).reply,/Which step fails/);
 assert.match((await reply('If I take over and get the property under contract, will the bot find a buyer?')).reply,/until you choose Return to bot/);
 assert.match((await reply('What happens when you click call but you’re not handling it yourself? Does the AI take over in a live call? Can the person hear me?')).reply,/browser microphone.*seller can hear you/);
 assert.equal(requests,0,'known observed failures must not spend on a model');
}finally{process.env=previous;}
console.log(`PASS ${checks} support inbox replays plus intent boundaries; no provider calls or customer writes.`);
