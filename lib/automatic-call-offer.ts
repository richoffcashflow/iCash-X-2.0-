import {z} from 'zod';
import {runScreeningJob} from './screening-job.ts';
import {cashOfferCalculation} from './cash-offer-math.ts';
import {sellerCallFinancialGate} from './equity-screen.ts';
import {sellerPayoffPosition,type SellerPayoffReport,type SellerPayoffUpdate} from './seller-payoff.ts';
import {canonical,object,sha} from './required-call-recording.ts';

const conversationId=z.string().regex(/^conv_[A-Za-z0-9]+$/);
const cents=z.number().int().safe().nonnegative().max(100000000000);
export const automaticOfferInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('get_offer'),conversationId}).strict(),
 z.object({action:z.literal('accept_offer'),conversationId,priceCents:cents.positive(),quoteRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('update_repairs'),conversationId,sellerStatement:z.string().trim().min(3).max(1000),repairEstimateCents:cents.nullish().transform(v=>v??undefined)}).strict(),
 z.object({action:z.literal('report_change'),conversationId,sellerStatement:z.string().trim().min(1).max(1000)}).strict(),
]);
export type AutomaticOfferState={listedWithAgent?:boolean;listingStatement?:string;payoffReport?:SellerPayoffReport;repairEstimateCents?:number;conditionPending?:boolean;factsPending?:boolean;payoffPending?:boolean;payoffStatement?:string;contractBlocked?:boolean;acceptanceConditional?:boolean;agreementRevisionRequired?:boolean;sellerStatement?:string;acceptedPriceCents?:number|null;quotedPriceCents?:number|null;quoteRevision?:string;snapshotHash?:string};
export type CallOfferContext={party:'seller'|'buyer'|'unknown';accountId?:string;dealId?:string;address?:string;snapshot?:unknown;terms?:unknown;pendingAgreement?:{priceCents:number;closingDate:string}|null;buyer?:{askingPriceCents:number;purchasePriceCents?:number;assignmentFeeCents?:number;address:string};offerState?:AutomaticOfferState|null;offerVersion?:number};
export const blockedOffer=(reason:string,instruction:string)=>({quoteAllowed:false as const,priceCents:null,reason,instruction});

/** Server-owned spoken amount gives both the voice model and validator the same spelling. */
export function offerPricePresentation(priceCents:number){
 if(!Number.isSafeInteger(priceCents)||priceCents<1||priceCents>100000000000)throw Error('Invalid authorized price');
 const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
 const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
 const words=(n:number):string=>{
  if(n<20)return small[n];
  if(n<100)return tens[Math.floor(n/10)]+(n%10?'-'+small[n%10]:'');
  if(n<1000)return small[Math.floor(n/100)]+' hundred'+(n%100?' '+words(n%100):'');
  const scale=n>=1e9?1e9:n>=1e6?1e6:1000,name=scale===1e9?'billion':scale===1e6?'million':'thousand';
  return words(Math.floor(n/scale))+' '+name+(n%scale?' '+words(n%scale):'');
 };
 const dollars=Math.floor(priceCents/100),cents=priceCents%100;
 return {displayPrice:(priceCents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents?2:0}),spokenPrice:words(dollars)+(dollars===1?' dollar':' dollars')+(cents?' and '+words(cents)+(cents===1?' cent':' cents'):'')};
}

// This classification permits discussing a conditional price only. It never
// verifies a payoff, replaces research, or clears an earlier ownership change.
function payoffOnly(statement:string){
 return /\b(mortgage|payoff|loan|heloc|owe|owed|debt|paid off)\b/i.test(statement)
  && !/\b(owner|owners|ownership|deed|inherited|divorce|title|property|properties|address|repair|repairs|roof|condition|foundation|fire|damage|offer|price)\b/i.test(statement);
}
function conditionalInstruction(price:number,payoffRecorded:boolean,accepted=false){
 const amount=offerPricePresentation(price).displayPrice;
 const spokenOffer=`We can offer ${amount} cash, as is. That accounts for repairs and holding costs and is subject to confirming the mortgage payoff and any liens.`;
 const nextQuestion=payoffRecorded?'Does that price work for you, subject to confirming the payoff?':'What is the current mortgage payoff balance?';
 return {spokenOffer,nextQuestion,instruction:accepted
  ? 'Save this as conditional verbal acceptance only. Acknowledge the agreement on price and explain that the payoff must be checked before a contract can be sent. Do not say a contract was sent, promise seller proceeds, or ask again for an already recorded payoff.'
  : `This is a conditional price discussion; pause the normal contract-closing sequence. Present the exact conditional cash offer aloud now after qualification: ${spokenOffer} ${payoffRecorded?'The seller payoff answer is already recorded as unverified; acknowledge it without repeating the question.':''} Then ask: ${nextQuestion} Do not replace the offer with a refusal to reconcile numbers. contractAllowed is false. Do not proceed to contract closing questions or promise to prepare, text, or send an agreement while this review is unresolved. Say the payoff and any liens need checking before an agreement can be prepared. Never promise net proceeds.`};
}

/** Recompute in integer cents using the existing owner-selected formula. Seller
 * repair estimates remain unverified and never replace provider evidence. */
export function calculateAutomaticCallOffer(context:CallOfferContext,state:AutomaticOfferState,now=Date.now()){
 if(context.party==='buyer'){
  const b=context.buyer;
  if(!b||!Number.isSafeInteger(b.askingPriceCents)||b.askingPriceCents<=0)return blockedOffer('buyer_release_required','I need to confirm the current buyer package before quoting a price.');
  const breakdown=Number.isSafeInteger(b.purchasePriceCents)&&Number(b.purchasePriceCents)>0&&Number.isSafeInteger(b.assignmentFeeCents)&&Number(b.assignmentFeeCents)>=0&&Number(b.purchasePriceCents)+Number(b.assignmentFeeCents)===b.askingPriceCents?{purchasePriceCents:b.purchasePriceCents,assignmentFeeCents:b.assignmentFeeCents}:{};
  return {quoteAllowed:true as const,party:'buyer',priceCents:b.askingPriceCents,...offerPricePresentation(b.askingPriceCents),...breakdown,address:b.address,status:'approved_buyer_price',instruction:'Quote this exact total buyer price in dollars. The assignment fee is already included. Explain a numerical breakdown only if returned here. Use only the actual agreement for closing-cost terms.'};
 }
 if(context.party!=='seller'||!context.address)return blockedOffer('property_context_required','Which property are you calling about, and are you buying or selling?');
 if(state.listedWithAgent===true)return blockedOffer('listed_with_agent','We do not purchase properties currently listed with an agent. Thank them and politely end the offer conversation. Do not quote, accept an offer or send an agreement. Do not suggest cancelling their listing.');
 if(state.agreementRevisionRequired)return blockedOffer('issued_agreement_changed','The changed property facts require revising the existing agreement before new terms can be confirmed.');
 if(state.factsPending&&!state.payoffPending)return blockedOffer('property_facts_changed','The updated property or ownership information needs to be confirmed before I can quote a price.');
 if(state.conditionPending)return blockedOffer('repair_estimate_required','About how much do you estimate the total repairs will cost?');
 const pending=context.pendingAgreement;
 if(pending&&Number.isSafeInteger(pending.priceCents)&&pending.priceCents>0&&state.repairEstimateCents===undefined){
  return {quoteAllowed:true as const,contractAllowed:true,party:'seller',priceCents:pending.priceCents,...offerPricePresentation(pending.priceCents),address:context.address,status:'pending_agreement',instruction:'Continue from this exact prepared agreement price and its saved terms. A verbal yes is not a signature.'};
 }
 try{
  const base=runScreeningJob(context.snapshot,now);
  if(base.property.address!==context.address)return blockedOffer('property_mismatch','I need to confirm the property record before quoting a price.');
  const providerRepairs=base.property.repairs.baselineCents;
  const repairs=state.repairEstimateCents===undefined?providerRepairs:providerRepairs===null?state.repairEstimateCents:Math.max(providerRepairs,state.repairEstimateCents);
  const calculation=cashOfferCalculation(base.property.estimatedMarketValueCents,repairs);
  const financial=sellerCallFinancialGate(base.property.financialScreening,{sellerOfferCents:calculation?.sellerCeilingCents??null,sellerCostReserveCents:Number.isSafeInteger(object(context.snapshot).sellerCostReserveCents)?Number(object(context.snapshot).sellerCostReserveCents):null,checkedAt:now});
  if(object(context.snapshot).propertyType!=='house'||!calculation?.sellerCeilingCents)return blockedOffer('calculation_required','I need current value and repair estimates before calculating a cash offer.');
  const agreed=state.acceptedPriceCents;
  if(agreed&&agreed>calculation.sellerCeilingCents)return blockedOffer('agreed_price_needs_update','The updated numbers do not support the previously discussed price. We need to reconcile that before confirming revised terms.');
  const price=agreed??calculation.sellerCeilingCents;
  const payoff=sellerPayoffPosition(state.payoffReport,price);
  const conditional=!!state.payoffPending||(payoff?(!payoff.complete||!payoff.canProceed):financial.status!=='eligible');
  const accepted=!!agreed&&!state.acceptanceConditional;
  const common={quoteAllowed:true as const,party:'seller',priceCents:price,...offerPricePresentation(price),address:context.address,repairEstimateCents:repairs,repairSource:state.repairEstimateCents===undefined?'property_research':'seller_reported_total_budget',asIs:true,payment:'cash'};
  if(payoff){
   const nextQuestion=state.payoffPending?'Can you confirm the current mortgage payoff balance?':!payoff.complete?'Are there any other loans, liens, unpaid taxes or HOA balances besides that mortgage?':payoff.shortfallCents>0&&!payoff.canProceed?state.payoffReport?.coverageDeclined?'Would you like a person to review any other options?':`The difference is ${offerPricePresentation(payoff.shortfallCents).displayPrice}. Would you be willing and able to bring that amount to closing to sell the property?`:null;
   return {...common,payoffVerified:false,titleVerificationRequiredBeforeClosing:true,payoffSource:'seller_reported',reportedPayoff:payoff,conditional,contractAllowed:!conditional,status:conditional?'conditional_proposal':accepted?'verbally_accepted':'calculated_proposal',nextQuestion,
    instruction:conditional?`Keep the exact cash offer unchanged. ${nextQuestion} Do not ask the seller to reconcile records or repeat a saved balance. Do not send the agreement until the reported debts and any shortfall are addressed. Never promise lender approval or ask for payment now.`:`The seller-reported debts ${payoff.complete&&payoff.shortfallCents>0?'exceed the cash price, and the seller explicitly agreed to cover the stated difference at closing':'fit within the cash offer'}. Continue price acceptance and the remaining closing confirmations, then prepare/text the agreement. A mortgage is not a reason to stop. Title will obtain actual payoffs and confirm final proceeds before closing; do not call these figures verified or guarantee net proceeds.`};
  }
  if(conditional)return {...common,conditional:true,contractAllowed:false,payoffVerified:false,status:agreed?'conditional_accepted':'conditional_proposal',conditions:['Mortgage payoff and any liens must be confirmed before a contract is sent.'],...conditionalInstruction(price,!!state.payoffStatement,!!agreed)};
  return {...common,conditional:false,contractAllowed:true,status:accepted?'verbally_accepted':'calculated_proposal',instruction:accepted?'Keep this exact verbally accepted price and continue the remaining closing confirmations.':'Present this exact nonbinding as-is cash purchase price after qualification. Do not promise net proceeds or invent adjustments. Obtain acceptance again if a previous offer was conditional.'};
 }catch{return blockedOffer('current_research_required','The property research needs updating before I can confirm a cash offer.');}
}

type Db=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Db;bind:(token:string,conversationId:string)=>Promise<void>;resolveStatement?:(input:Record<string,unknown>)=>Promise<string|null>;verifyInput:(input:Record<string,unknown>)=>Promise<boolean>;verifyPayoffChange?:(input:Record<string,unknown>)=>Promise<boolean>;verifyListingStatus?:(input:Record<string,unknown>)=>Promise<boolean|null>;verifyPayoffFacts?:(input:Record<string,unknown>)=>Promise<SellerPayoffUpdate|null>;now?:()=>number};
export async function automaticCallOffer(token:string,input:unknown,d:Dependencies){
 const i=automaticOfferInput.parse(input),hash=sha(token);await d.bind(token,i.conversationId);
 const context=await d.db<CallOfferContext|null>('rpc/icash_call_offer_context','POST',{p_hash:hash,p_conversation:i.conversationId});
 if(!context)return blockedOffer('current_call_required','I cannot retrieve the offer for this call right now. Retry get_offer once. If it still fails, explain the technical problem once and arrange follow-up; do not repeat answered questions or say you are still confirming details.');
 if(context.party==='buyer')return i.action==='get_offer'?calculateAutomaticCallOffer(context,{},(d.now??Date.now)()):blockedOffer('buyer_terms_locked','The buyer price comes from the current under-contract package; changed terms need review.');
 if(context.party!=='seller')return calculateAutomaticCallOffer(context,{},(d.now??Date.now)());
 const state:AutomaticOfferState={...context.offerState},snapshotHash=sha(JSON.stringify(canonical(context.snapshot))),now=(d.now??Date.now)();
 if(i.action==='accept_offer'&&!await d.verifyInput(i))return blockedOffer('acceptance_confirmation_required','Please confirm that the exact cash price we just discussed works for you.');
 if(i.action==='update_repairs'||i.action==='report_change'){
  const actual=await d.resolveStatement?.(i);if(actual)i.sellerStatement=actual;
  if(context.pendingAgreement)state.agreementRevisionRequired=true;
  const verified=await d.verifyInput(i);state.sellerStatement=verified?i.sellerStatement:'Statement confirmation required';state.acceptedPriceCents=null;
  if(i.action==='report_change'){
   const listing=await d.verifyListingStatus?.(i);
   if(typeof listing==='boolean'){state.listedWithAgent=listing;state.listingStatement=i.sellerStatement;}
   else {
   const update=await d.verifyPayoffFacts?.(i);
   if(update)state.sellerStatement=i.sellerStatement;
   const unrelatedHold=!!state.factsPending&&!state.payoffPending;
   if(update&&!unrelatedHold){
    const previous=state.payoffReport??{};
    const debtChanged=update.mortgageCents!==undefined&&update.mortgageCents!==previous.mortgageCents||update.otherDebtCents!==undefined&&update.otherDebtCents!==previous.otherDebtCents;
    state.payoffReport={...previous,...(debtChanged?{coveredShortfallCents:undefined,coverageDeclined:undefined}:{}),...update};
    state.payoffStatement=i.sellerStatement;state.payoffPending=false;state.factsPending=false;
   }else{
   state.payoffPending=verified&&(!state.factsPending||!!state.payoffPending)&&(payoffOnly(i.sellerStatement)||!!await d.verifyPayoffChange?.(i));
   if(state.payoffPending)state.payoffStatement=i.sellerStatement;
   state.factsPending=true;
   }
   }
  }
  else {
   let researchRepairs:number|null=null;try{researchRepairs=runScreeningJob(context.snapshot,now).property.repairs.baselineCents;}catch{}
   state.conditionPending=!verified||(i.repairEstimateCents===undefined&&state.repairEstimateCents===undefined&&researchRepairs===null);
   if(verified&&i.repairEstimateCents!==undefined)state.repairEstimateCents=i.repairEstimateCents;
  }
 }
 const offer=calculateAutomaticCallOffer(context,state,now);
 const contractBlocked=!offer.quoteAllowed||('contractAllowed' in offer&&offer.contractAllowed===false);
 const revision=sha(JSON.stringify(canonical({snapshotHash,payoffReport:state.payoffReport??null,repairs:state.repairEstimateCents??null,conditionPending:!!state.conditionPending,factsPending:!!state.factsPending,payoffPending:!!state.payoffPending,contractBlocked,priceCents:offer.priceCents})));
 if(i.action==='accept_offer'){
  if(!offer.quoteAllowed||offer.party!=='seller'||i.priceCents!==offer.priceCents||i.quoteRevision!==revision||state.quoteRevision!==revision||state.quotedPriceCents!==i.priceCents)return blockedOffer('quote_changed','The saved quote changed. Let me confirm the current amount before we agree to it.');
  state.acceptedPriceCents=i.priceCents;
  state.acceptanceConditional=contractBlocked;
 }
 state.contractBlocked=contractBlocked;
 state.snapshotHash=snapshotHash;state.quotedPriceCents=offer.priceCents;state.quoteRevision=revision;
 const saved=await d.db<boolean>('rpc/icash_save_call_offer','POST',{p_hash:hash,p_conversation:i.conversationId,p_expected_version:context.offerVersion??0,p_expected_snapshot:context.snapshot,p_state:state,p_action:i.action});
 if(saved!==true)return blockedOffer('quote_changed','The property record changed while I checked. Let me get the current calculation.');
 return {...offer,quoteRevision:revision,...(i.action==='accept_offer'?(contractBlocked?{status:'conditional_accepted',...(state.payoffReport?{instruction:offer.instruction}:conditionalInstruction(i.priceCents,!!state.payoffStatement,true))}:{status:'verbally_accepted',instruction:'Verbal acceptance saved at this exact price. Continue closing date, legal name, owners, inspection preference and prepared terms, then confirm_and_send. This is not a signature.'}):{})};
}
