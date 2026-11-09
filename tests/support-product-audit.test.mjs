// Anonymized wording from support failures; no customer IDs or paid calls.
import assert from 'node:assert/strict';
import {replyToSupport,supportConversationFallback} from '../lib/support-conversation.ts';
import {supportCourseAnswer} from '../lib/support-product-guide.ts';
import {cashOfferPolicy} from '../lib/cash-offer-math.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const env={...process.env};
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='offline';process.env.ICASH_SUPPORT_AI_MODEL='offline';
let modelCalls=0;const noModel=async()=>{modelCalls++;throw Error('Known product facts must be available without AI');};
const cases=[
 ['What company do I say I’m coming from when I’m talking to leads',/individual or company name.*Settings/,/add listings|upload|generate leads/],
 ['What business name should I use when calling sellers?',/representing yourself or your business/,/add listings|Course/],
 ['How do I obtain a purchase agreement from the buyer',/cash buyer signs an assignment agreement.*purchase agreement is with the seller/,/Take over|Seller is ready/],
 ['Where do I download the buyer contract?',/Download assignment draft/,/Seller is ready/],
 ['if i added 10 dollars how many leads can i get',/isn’t a fixed number.*property research/,/add listings|upload|Course/],
 ['how many leads will i have if i put 10 dollars in',/Adding money does not guarantee a lead/,/add listings|upload|Course/],
 ['How many calls can $25 get?',/isn’t a fixed number/,/guaranteed calls/],
 ['How long will $10 in credits last?',/depends on the work completed/,/add listings|Course/],
 ['whats the 10 dollarsfor',/prepaid work credits for property research, contact lookup, calls, texts/,/confirmed answer|What are you trying/],
 ['what is the 10 dollars for',/separate from the software subscription/,/readiness|couldn’t verify/],
 ['why do i have to add money',/subscription.*include \$0 in work credits/,/readiness|set up/],
 ['How much do credits cost?',/prepaid dollar balance.*Add money/,/confirmed answer|What are you trying/],
 ['What is the $50 monthly payment for?',/software subscription pays for access.*separately purchased work credits/,/Added money becomes prepaid/],
 ['will the assingment fee be presented before the call with the ai is occuring',/AI can call sellers.*fee is recorded in the buyer assignment agreement/,/included in (?:the )?purchase agreement|AI bot does not call/],
 ['Where is my assignment fee shown?',/buyer assignment agreement, separate from the seller purchase agreement/,/fee is included in the seller purchase/],
 ['How much is the wholesale fee',/default target wholesale fee.*\$10,000.*\$300,000.*\$20,000/,/VIP|coaching|upgrade/],
 ['Does icashx calculate in the 70% rule as well as wholesale fee',/default target wholesale fee/,/VIP|coaching|upgrade/],
 ['does ai contact buyers',/contact them by text and email.*incoming buyer calls can be handled by AI/,/bot does not make calls/],
 ['how do i find the buyers',/bot can find eligible cash buyers/,/networking|freelance/],
 ['Does the AI call sellers?',/bot can make eligible seller calls/,/bot does not call/],
 ['does ai go on the phone with the title company ???',/Title coordination uses email.*system can email the documents and follow up/,/You handle communication/],
 ['so will I need to manual submit to the title company ?',/handle title submission in the app.*email the signed purchase agreement/,/outside the system|yourself outside/],
 ['once a cash offer is generated with the AI bot can it be adjusted or is that final ?',/calculated ceiling.*negotiate.*edit an unsigned agreement/,/can’t adjust|considered final/],
 ['does 2.0 still use deal machine automatically ?',/uses DealMachine for automatic property research/,/does not use|separate tool/],
 ['can 2.0 send me the details it used to calculate the cash offer so that I can use that to get the ARV ?',/Value after repairs.*Offer calculation.*ARV × 70% − repairs − wholesale fee/,/own methods|own tools|does not provide/],
 ['how can i send buyers their ARV to make things faster',/buyer package can show.*View buyer package/,/does not send ARV/],
 ['does 2.0 tell buyers their ARV ?',/buyer package can show.*research ARV/,/does not send ARV/],
];
try{
 assert.equal(cashOfferPolicy.standardFeeCents,1000000);assert.equal(cashOfferPolicy.largeDealFeeCents,2000000);
 for(const kind of ['account','access'])for(const [question,expected,forbidden] of cases){
  const answer=await replyToSupport({kind,messages:[user(question)],evidence:[]},noModel);
  assert.match(answer.reply,expected,question);assert.doesNotMatch(answer.reply,forbidden,question);
  assert.equal(answer.status,'resolved',question);assert.equal(answer.ai,false,question);
 }
 const prior=[user('My bot is not calling'),assistant('I have not confirmed why calls stopped.'),user('How do I obtain a purchase agreement from the buyer')];
 assert.equal((await replyToSupport({kind:'account',messages:prior,evidence:[]},noModel)).status,'open','a feature answer must preserve the earlier fault');
 for(const question of ['Why was I billed $10?','My $10 payment is missing','I was charged twice for credits','The buyer assignment will not send','How do I fix the buyer assignment that will not send?','My seller calls are not working','My title email failed','How do I contact title? They have not responded']){
  const answer=supportConversationFallback({kind:'account',messages:[user(question)],evidence:[]});
  assert.notEqual(answer.status,'resolved',question);assert.doesNotMatch(answer.reply,/Added money becomes|isn’t a fixed number|handle title submission in the app/,question);
 }
 for(const question of ['What is the $50 monthly payment for?','What is $50 subscription for?','What is the $120 VIP payment for?']){
  const answer=supportConversationFallback({kind:'account',messages:[user(question)],evidence:[]});
  assert.doesNotMatch(answer.reply,/Added money becomes prepaid|It is separate from the software subscription/,question);
 }
 const arv=await replyToSupport({kind:'account',messages:[user('How can I send buyers the ARV?'),assistant('Review the buyer package.'),user('does 2.0 tell them their ARV ?')]},noModel);
 assert.match(arv.reply,/buyer package can show/);
 const ambiguous=await replyToSupport({kind:'account',messages:[user('does 2.0 tell them their ARV ?')]},noModel);
 assert.match(ambiguous.reply,/seller or with a cash buyer/);assert.notEqual(ambiguous.status,'resolved');
 for(const fault of ['The page is broken.','It is stuck.','The page will not load.']){
  const answer=await replyToSupport({kind:'account',allowAI:false,messages:[user('How do I contact buyers?'),assistant('Use the buyer package.'),user('Can it send them the ARV? '+fault)]},noModel);
  assert.equal(typeof answer.reply,'string');assert.notEqual(answer.status,'resolved');
 }
 for(const question of ['The buyer agreement is blank. How do I download it?','How do I send the buyer contract? The button is disabled.','How do I submit to title? It is blocked.','How do I view the ARV? The page keeps spinning.']){
  const answer=await replyToSupport({kind:'account',allowAI:false,messages:[user(question)]},noModel);
  assert.notEqual(answer.status,'resolved',question);assert.doesNotMatch(answer.reply,/buyer signs an assignment|handle title submission in the app|current cash-offer formula/i,question);
 }
 for(const question of ['How much wholesale fee should I charge on this deal?','How much should my wholesale fee be for this property?','How do I maximize the wholesale fee on my deal?']){
  const answer=await replyToSupport({kind:'account',messages:[user(question)]},noModel);
  assert.match(answer.reply,/Ask AI Bot/);assert.equal(answer.status,'open');assert.doesNotMatch(answer.reply,/default target wholesale fee/);
 }
 assert.match((await replyToSupport({kind:'account',messages:[user('How long till a lead usually comes through')]},noModel)).reply,/fixed schedule/);
 for(const question of ['Need help customer service','What company do I say I’m coming from when I’m talking to leads'])assert.equal(supportCourseAnswer([user(question)]),null,question);
 assert.equal(modelCalls,0);
}finally{process.env=env;}
console.log('PASS support product audit: real inbox intent, company identity, buyer documents/fees, credits, offer math/editing, research, buyer/title automation and fault boundaries; offline only.');
