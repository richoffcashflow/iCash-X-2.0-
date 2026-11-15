// Offline prompt-admission regression. Execute the actual private dispatch
// assembly block, not a shorter reconstruction of its runtime instructions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {sellerCallContext,compactSellerProgress} from '../lib/seller-call-context.ts';
import {automaticOfferReceptionPrompt,payoffAutomaticOfferReceptionPrompt,legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,progressAutomaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {sellerAgreementDeliveryPrompt} from '../lib/seller-agreement-delivery-prompt.ts';
import {sellerCallerIdentityPrompt,sellerContactStopInstructions} from '../lib/seller-caller-identity.ts';
import {efficientSellerPrompt} from '../lib/seller-conversation-efficiency.ts';
import {outboundSellerCadencePrompt} from '../lib/seller-call-cadence.ts';
import {conversationAddressFields,conversationAddressInstructions} from '../lib/conversation-address.ts';
import {automaticOfferPolicy} from '../lib/automatic-offer-policy.ts';
import {acquisitionOpeners} from '../lib/deal-conversation.ts';
import {opportunityConversationInstructions} from '../lib/outreach-conversation.ts';

const source=readFileSync(new URL('../lib/live-dispatch-service.ts',import.meta.url),'utf8');
const start=source.indexOf(' const sellerProgress='),end=source.indexOf(' const operationKey=',start);
assert(start>0&&end>start,'Keep the complete actual assembly and admission block');
const block=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
assert(block.includes('24000 - buildPrompt().length - 64'));
assert(block.includes('voice_context_too_large'));
const dependencies={sellerCallContext,compactSellerProgress,automaticOfferReceptionPrompt,payoffAutomaticOfferReceptionPrompt,legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,progressAutomaticOfferReceptionPrompt,sellerAgreementDeliveryPrompt,sellerCallerIdentityPrompt,efficientSellerPrompt,outboundSellerCadencePrompt,conversationAddressFields,conversationAddressInstructions,automaticOfferPolicy,acquisitionOpeners,opportunityConversationInstructions,createHash};
const names=[...Object.keys(dependencies),'intake','cancellation','recordedReview','buyerContext','sellerContext','purchaseTerms','p','address','identity','account','accountId','limited','db','assignSharedLearning','SharedLearningSafetyHold','sellerPrompt','sellerGreeting','hold'];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const assemble=new AsyncFunction('fixture',`const {${names.join(',')}}=fixture;\n${block}\nreturn {status:'assembled',prompt,automaticContext};`);
const now=new Date().toISOString();
const history={threadId:'fixture-thread',messages:[
 {id:'q1',direction:'outgoing',body:'Is it vacant?',at:now},
 {id:'a1',direction:'incoming',body:'Yes, vacant.',at:now},
]};
const priorCalls=[{completed_at:now,result:{transcript:[
 {role:'agent',message:'What is the condition of the house?'},
 {role:'user',message:'Original seller detail: the porch railing needs repair.'},
 {role:'agent',message:'When would you like to close?'},
 {role:'user',message:'About thirty days, after the title company checks the paperwork.'},
 {role:'agent',message:'Is the property occupied?'},
 {role:'user',message:'It is vacant, and I can coordinate access after we agree on the purchase terms.'},
]}}];
const base={...dependencies,intake:null,cancellation:null,recordedReview:{offerPolicy:'automatic_offer_v9'},buyerContext:null,purchaseTerms:{inspectionDays:10,closingDate:'',escrowAgent:''},p:{party:'seller',screening_id:'fixture-screening',contact_key:'fixture-contact'},account:{assistant_name:'Alex'},accountId:'fixture-account',limited:false,db:async()=>{throw Error('NO DATABASE IN PROMPT FIXTURE');},SharedLearningSafetyHold:class extends Error{},sellerPrompt:'unused automatic policy branch',sellerGreeting:'Is this the owner?',hold:reason=>({status:reason})};
const fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('NO NETWORK IN PROMPT FIXTURE');};
try{
 for(const scenario of [
  {principal:'Fixture Buyer',company:'Fixture Buyer',address:'45 Fixture Lane, Dallas, TX 75201',saved:false,assigned:false},
  {principal:'Fixture Property Investments',company:'Fixture Property Investments LLC',address:'1234 North Fixture Boulevard, Fort Worth, TX 76102',saved:true,assigned:true},
 ]){
  const sellerContext={buyerKind:'company',address:scenario.address,principal:scenario.principal,assistantName:'Alex',history:scenario.saved?history:null,priorCalls:scenario.saved?priorCalls:[],request:{name:'Jordan',submittedAt:now}};
  const result=await assemble({...base,address:scenario.address,identity:{principal:scenario.principal,company_name:scenario.company},sellerContext,assignSharedLearning:async()=>scenario.assigned?{variant:'cash_interest'}:null});
  assert.equal(result.status,'assembled','Ordinary seller call must not become voice_context_too_large');
  assert(result.prompt.length<=24000,'Existing provider input ceiling remains unchanged');
  assert(result.prompt.includes(sellerContactStopInstructions),'The complete hard-stop rule survives admission');
  assert(result.prompt.includes('SELLER CALLER IDENTITY AND REFUSAL'));
  assert(result.prompt.includes(JSON.stringify(scenario.principal)),'Use actual bound buyer identity');
  assert(!result.prompt.includes('BUYER IDENTITY:'));
  if(scenario.saved){
   assert(result.prompt.includes('REVIEWED INTEREST QUESTION'));
   assert(result.prompt.includes('Original seller detail:'),'Keep whole actual seller answers after adding instructions');
   assert(result.automaticContext.priorExchanges.length>=2,'Prompt additions leave room for conversation continuity');
   assert(result.automaticContext.recentSms.length>=1,'Retain the latest text answer as well as call history');
  }
 }
 console.log('PASS seller hard-stop runtime: actual full dispatch assembly, 24000 admission, real identity, learning question and whole saved text/call answers. No provider calls.');
}finally{globalThis.fetch=fetchBefore;}
