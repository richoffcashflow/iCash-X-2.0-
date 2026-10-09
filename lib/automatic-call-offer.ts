import {buyerPackagePhotos} from './buyer-package-photos.ts';
import {buyerClosingDate,buyerScenarioGuidance} from './buyer-scenario-guidance.ts';
import {sellerViewingSlots,viewingSlotLabel,buyerViewingFollowup} from './buyer-purchase-terms.ts';
import {conversationAddressFields} from './conversation-address.ts';
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
export type AutomaticOfferState={proposedPriceCents?:number;listedWithAgent?:boolean;listingStatement?:string;payoffReport?:SellerPayoffReport;repairEstimateCents?:number;conditionPending?:boolean;factsPending?:boolean;payoffPending?:boolean;payoffStatement?:string;contractBlocked?:boolean;acceptanceConditional?:boolean;agreementRevisionRequired?:boolean;sellerStatement?:string;acceptedPriceCents?:number|null;quotedPriceCents?:number|null;quoteRevision?:string;snapshotHash?:string};
export type CallOfferContext={party:'seller'|'buyer'|'unknown';sellerContractSigned?:boolean;viewingSlots?:unknown;accountId?:string;dealId?:string;address?:string;snapshot?:unknown;terms?:unknown;pendingAgreement?:{priceCents:number;closingDate:string}|null;buyer?:{propertyImages?:unknown;latitude?:unknown;longitude?:unknown;sellerPhotos?:unknown;arvCents?:number|null;repairsCents?:number|null;askingPriceCents:number;purchasePriceCents?:number;assignmentFeeCents?:number;closingDate?:string|null;address:string;depositCents?:number|null;viewingSlots?:unknown;reserved?:boolean;titleSelectionStatus?:'not_selected'|'selected'|'needs_confirmation'};offerState?:AutomaticOfferState|null;offerVersion?:number};
export const blockedOffer=(reason:string,instruction:string)=>({quoteAllowed:false as const,priceCents:null,reason,instruction});
export const currentCallUnavailableOffer=()=>({...blockedOffer('current_call_required','Current deal details could not be confirmed. Retry get_offer at most once for a technical failure; never keep retrying or guess a price. No agreement, payment, viewing or callback is authorized or scheduled. Say: "I cannot confirm the current deal details. They need team review; no callback has been scheduled." Do not agree when the caller assumes someone will reach out. Do not promise that the team will review, call, text, send or arrange anything. Answer briefly without generic closing questions.'),contractAllowed:false,sent:false,callbackScheduled:false,viewingFollowupRequired:false});
const blockedBuyerOffer=(reason:string,instruction:string)=>({...blockedOffer(reason,`${buyerScenarioGuidance}\nCURRENT AVAILABILITY OVERRIDE: ${instruction} This overrides the normal viewing and payment flow. Do not offer seller-availability follow-up or say we will check with the seller. No visit, callback, payment or delivery is authorized or scheduled.`),party:'buyer' as const,contractAllowed:false,sent:false,viewingAllowed:false,viewingFollowupRequired:false,callbackScheduled:false});
export const buyerAgreementHandoff=()=>({...blockedOffer('buyer_assignment_team_required','No buyer agreement has been prepared, queued or sent by this tool. The team must prepare the buyer assignment and provide verified payment instructions. The completed call records the request for review. Do not claim delivery, promise delivery timing, change buyer terms or run seller signing questions.'),party:'buyer',contractAllowed:false,sent:false,status:'not_sent'});

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
  if(b?.reserved===true)return {...blockedBuyerOffer('buyer_reserved','This property is already reserved. Say: "This property is reserved, so I cannot arrange a viewing or accept a deposit from another buyer." Do not offer viewing coordination, compete with the existing buyer, suggest payment if the deal falls through, promise priority, or disclose the other buyer. A buyer with an existing agreement can contact the team for closing coordination.'),reserved:true};
  if(!b||!Number.isSafeInteger(b.askingPriceCents)||b.askingPriceCents<=0||b.askingPriceCents>100000000000)return blockedBuyerOffer('buyer_release_required','The current buyer package needs confirmation before any price, availability, payment or access can be discussed. Do not guess or promise follow-up.');
  const date=buyerClosingDate(b.closingDate);
  if(date&&Date.parse(date+'T23:59:59Z')+14*3600000<now)return blockedBuyerOffer('buyer_terms_stale','The package closing date has passed. Current availability and terms need team confirmation. Do not solicit a deposit, invent an extension, offer a viewing or promise access.');
  const photos=buyerPackagePhotos(b);
  const propertyPhotoCount=photos.length,sellerPhotoCount=photos.filter(photo=>photo.caption==='Seller-provided property photo').length;
  const estimate=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100000000000?v:null;
  const estimatedArvCents=estimate(b.arvCents),estimatedRepairsCents=estimate(b.repairsCents);
  const researchMoney=(amount:number|null)=>amount===null?null:amount===0?{displayPrice:'$0',spokenPrice:'zero dollars'}:offerPricePresentation(amount);
  const arv=researchMoney(estimatedArvCents),repairs=researchMoney(estimatedRepairsCents);
  const researchEstimates={arv:arv?.displayPrice??null,repairs:repairs?.displayPrice??null};
  const spokenResearchEstimates=`${arv?'The research ARV estimate is '+arv.spokenPrice+'.':'No ARV estimate has been supplied.'} ${repairs?'The research repair estimate is '+repairs.spokenPrice+'.':'No repair estimate has been supplied.'} These are research estimates, not guarantees or an inspection.`;
  const closingDateSpoken=date?new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}):null;
  const price=offerPricePresentation(b.askingPriceCents);
  const spokenPriceTerms=`The price is ${price.spokenPrice}, including the assignment fee. You pay all buyer closing costs separately.`;
  const deposit=Number.isSafeInteger(b.depositCents)&&Number(b.depositCents)>0&&Number(b.depositCents)<=500000?Number(b.depositCents):null;
  const depositSpoken=deposit===null?null:offerPricePresentation(deposit).spokenPrice;
  const viewingSlots=sellerViewingSlots(b.viewingSlots,now).map(viewingSlotLabel);
  const spokenDeposit=depositSpoken?`The non-refundable deposit is ${depositSpoken}, credited toward the included assignment fee under the agreement.`:null;
  const spokenOffer=`I'm the AI assistant for the contract holder. ${spokenPriceTerms} ${closingDateSpoken?'Closing is '+closingDateSpoken+'.':'The closing date needs confirmation.'} ${spokenDeposit??'The deposit amount needs confirmation in the assignment agreement.'}`;
  const titleSelectionStatus=b.titleSelectionStatus??'unknown';
  const spokenTitleStatus=titleSelectionStatus==='not_selected'?'The title company has not been selected yet.':titleSelectionStatus==='selected'?'A title contact is already selected for this deal.':titleSelectionStatus==='needs_confirmation'?'A title contact is recorded, but it still needs confirmation.':'The title status needs team confirmation.';
  const titleInstruction=titleSelectionStatus==='not_selected'
   ? 'No title company has been selected for this deal. If asked, say that directly. Only when title is discussed, ask whether they have closed an assignment deal with a wholesaler before. Ask at most once per call; if ignored or deferred, move on without repeating it. Do not add this question to viewing or agreement answers. If yes, ask which local title company they used; we can work with that company once the team confirms it handles assignments and this property. The company name alone is enough to record a preference. Ask for optional escrow contact and phone or email at most once; accept missing details without asking the buyer to find them. Reuse details already volunteered. If they have no experience or no company, say the team can coordinate title; this does not disqualify them. A suggested company is a proposal for review, not a selected or verified closer. The completed call saves their details for the team. Never claim the company was contacted or title was opened.'
   : titleSelectionStatus==='selected'?'A title contact is already selected. Do not say title is undecided or replace that contact. Record any buyer preference for team review; do not name a company unless supplied by the verified deal context.'
   : titleSelectionStatus==='needs_confirmation'?'A title contact is recorded but needs confirmation. Do not say none is recorded or claim it is selected/verified. The team must confirm the existing contact before using it or changing to the buyer preference.'
   : 'The title selection status is unavailable. Do not name or assume a title company; the team needs to confirm it. You may collect a buyer title preference for review.';
  return {quoteAllowed:true as const,contractAllowed:false as const,sent:false,agreementStatus:'not_sent',callbackScheduled:false,paymentAuthorized:false,buyerTermsComplete:!!date&&deposit!==null,party:'buyer',titleSelectionStatus,spokenTitleStatus,propertyPhotoCount,sellerPhotoCount,researchEstimates,spokenResearchEstimates,priceCents:b.askingPriceCents,...price,...conversationAddressFields(b.address),closingDate:date,closingDateSpoken,buyerPaysClosingCosts:true,closingCostsIncluded:false,spokenOffer,depositCents:deposit,spokenDeposit,viewingOptional:true,viewingSlots,...(viewingSlots.length?{}:{viewingFollowupRequired:true,spokenViewingFollowup:buyerViewingFollowup}),depositPaymentMethods:['check','wire','cash_app','zelle'],viewingStatus:'needs_confirmation',status:'approved_buyer_price',instruction:`Speak clearly and matter-of-factly at a steady conversational pace. After the first terms read-back, answer the question directly in one or two short sentences, then wait; ask at most one useful question only when it is needed for their current request. Ask a question at most once per call, even if unanswered. Avoid hesitant fillers, repeated apologies, repeated holds and restarting the script. Use the current tool facts; do not recheck unchanged facts merely to discuss viewing or title. This is a BUYER inquiry. Read spokenOffer exactly and completely in your first reply, including the AI identity, price, closing-cost, closing-date and deposit sentences, even when the buyer only asks about payment or declines a visit: "${spokenOffer}" This is the asking price for the buyer, not an offer to buy their property. Never combine the assignment fee and closing costs as included items, call the price all-in, or say we cover buyer closing costs. The signed agreements allocate the buyer's additional closing costs; no dollar amount for those costs is available here. Do not omit the closing date from the first terms read-back. After that, do not repeat the full terms unless asked. Do not guess a missing date or deposit. If either is missing, the buyer is not authorized to pay yet; terms need team confirmation, and no callback or delivery has been scheduled. Do not disclose a percentage, calculation or cap. Check, wire, Cash App and Zelle are payment choices. Receiving details must come from the verified deal contact after agreement review; never invent a payee, handle, account or payment link. Explain that the property is reserved only after the assignment is signed and cleared deposit funds are verified. A payment claim or screenshot is not verified receipt. Viewing is optional. If they already asked for the agreement, acknowledge once: The buyer assignment has not been sent. The team needs to prepare it and provide verified payment instructions. Do not ask again whether they want it or append title/funding questions. Do not keep selling a viewing. This tool has NOT prepared, queued or sent a buyer agreement. Do not offer to send it yourself, use seller contract actions for a buyer, or claim a text/link/agreement was sent. The completed call records their request for team review; it has not notified or assigned anyone. Say: The team needs to prepare your buyer assignment and provide verified payment instructions. Never say I will prepare/send it, I will have the team send it, the team will send it, I have asked the team, or it will be sent shortly, including in the final goodbye. Never guarantee delivery or payment verification timing. ${viewingSlots.length?'Only if the buyer asks to view, offer these seller-provided windows: '+viewingSlots.join('; ')+'. Do not append viewing questions to title, payment, counteroffer, research or human requests.':'No current seller viewing windows are available. Do not invent times or say the seller has already been contacted.'} Ask only one question per turn. ${viewingSlots.length?'If they want a viewing, collect or reuse their preferred date, time and timezone, then read their exact calendar date, AM/PM time and timezone back once as a request awaiting confirmation. Do not say the time works perfectly or is booked.':'If they want a viewing or ask for available times, say exactly: '+buyerViewingFollowup+' They may wait for seller options without choosing a preferred date or time now. If they volunteer a preference, save it and read it back once; do not insist on a preference or keep asking for a time. Do not promise when the seller will reply. Keep the next step focused on seller availability; do not redirect this viewing request toward buying, paying or an assignment unless the buyer asks.'} The completed call records a request for team review; it does not notify or assign anyone. Do not claim any seller or title contact has happened. Seller availability is not a booked appointment; say the specific visit still needs seller or occupant confirmation. Identify yourself as the AI assistant coordinating for the contract holder. Do not claim to be the seller or owner, or describe a buyer as a financial partner without verified evidence. ${titleInstruction} ${buyerScenarioGuidance} Answer the current question and wait. Keep viewing answers focused on access; do not divert them to title, funding, paying or an agreement unless the buyer asks. Do not promise team action or timing in the goodbye. Do not run seller qualification, negotiate a different price or repeat answered questions.`};
 }
 if(context.party==='seller'&&context.sellerContractSigned===true){
  const slots=sellerViewingSlots(context.viewingSlots,now).map(viewingSlotLabel);
  return {...blockedOffer('seller_contract_signed',`The purchase contract is already signed. Do not restart qualification, quote a new offer or send another contract. ${slots.length?'Saved seller viewing windows: '+slots.join('; ')+'. Confirm whether these are still available; do not repeat answered questions.':'Ask for two or three exact dates and start/end times with AM or PM and timezone for property viewings.'} Ask one question at a time, clarify relative dates, and read back each window. A specific visit still needs seller or occupant confirmation. Identify yourself as the AI assistant for the contract holder, never as the seller or property owner. Do not call a visitor a financial partner without verified evidence.`),status:'seller_viewing_coordination',viewingSlots:slots};
 }
 if(context.party!=='seller'||!context.address)return blockedOffer('property_context_required','Which property are you calling about, and are you buying or selling?');
 if(state.listedWithAgent===true)return blockedOffer('listed_with_agent','We do not purchase properties currently listed with an agent. Thank them and politely end the offer conversation. Do not quote, accept an offer or send an agreement. Do not suggest cancelling their listing.');
 if(state.agreementRevisionRequired)return blockedOffer('issued_agreement_changed','The changed property facts require revising the existing agreement before new terms can be confirmed.');
 if(state.factsPending&&!state.payoffPending)return blockedOffer('property_facts_changed','The updated property or ownership information needs to be confirmed before I can quote a price.');
 if(state.conditionPending)return blockedOffer('repair_estimate_required','About how much do you estimate the total repairs will cost?');
 const pending=context.pendingAgreement;
 if(pending&&Number.isSafeInteger(pending.priceCents)&&pending.priceCents>0&&state.repairEstimateCents===undefined){
  return {quoteAllowed:true as const,contractAllowed:true,party:'seller',priceCents:pending.priceCents,...offerPricePresentation(pending.priceCents),...conversationAddressFields(context.address),status:'pending_agreement',instruction:'Continue from this exact prepared agreement price and its saved terms. A verbal yes is not a signature.'};
 }
 try{
  const base=runScreeningJob(context.snapshot,now);
  if(base.property.address!==context.address)return blockedOffer('property_mismatch','I need to confirm the property record before quoting a price.');
  const providerRepairs=base.property.repairs.baselineCents;
  const repairs=state.repairEstimateCents===undefined?providerRepairs:providerRepairs===null?state.repairEstimateCents:Math.max(providerRepairs,state.repairEstimateCents);
  const calculation=cashOfferCalculation(base.property.estimatedMarketValueCents,repairs);
  if(object(context.snapshot).propertyType!=='house'||!calculation?.sellerCeilingCents)return blockedOffer('calculation_required','I need current value and repair estimates before calculating a cash offer.');
  const agreed=state.acceptedPriceCents;
  if(agreed&&agreed>calculation.sellerCeilingCents)return blockedOffer('agreed_price_needs_update','The updated numbers do not support the previously discussed price. We need to reconcile that before confirming revised terms.');
  const proposed=state.proposedPriceCents;
  if(proposed!==undefined&&(!Number.isSafeInteger(proposed)||proposed<=0||proposed>calculation.sellerCeilingCents))return blockedOffer('seller_price_needs_review','The requested price is outside the current calculation. Discuss the current supported cash proposal without accepting the higher ask.');
  const price=agreed??proposed??calculation.sellerCeilingCents;
const financial=sellerCallFinancialGate(base.property.financialScreening,{sellerOfferCents:price,sellerCostReserveCents:Number.isSafeInteger(object(context.snapshot).sellerCostReserveCents)?Number(object(context.snapshot).sellerCostReserveCents):null,checkedAt:now});
  const payoff=sellerPayoffPosition(state.payoffReport,price);
  const conditional=!!state.payoffPending||(payoff?(!payoff.complete||!payoff.canProceed):financial.status!=='eligible');
  const accepted=!!agreed&&!state.acceptanceConditional;
  const common={quoteAllowed:true as const,party:'seller',priceCents:price,...offerPricePresentation(price),...conversationAddressFields(context.address),repairEstimateCents:repairs,repairSource:state.repairEstimateCents===undefined?'property_research':'seller_reported_total_budget',asIs:true,payment:'cash'};
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
type Dependencies={db:Db;bind:(token:string,conversationId:string)=>Promise<void>;resolveStatement?:(input:Record<string,unknown>)=>Promise<string|null>;verifyInput:(input:Record<string,unknown>)=>Promise<boolean>;verifyPayoffChange?:(input:Record<string,unknown>)=>Promise<boolean>;verifyListingStatus?:(input:Record<string,unknown>)=>Promise<boolean|null>;verifySellerPrice?:(input:Record<string,unknown>)=>Promise<number|null>;verifyPayoffFacts?:(input:Record<string,unknown>)=>Promise<SellerPayoffUpdate|null>;now?:()=>number};
export async function automaticCallOffer(token:string,input:unknown,d:Dependencies){
 const i=automaticOfferInput.parse(input),hash=sha(token);
 // The context RPC independently checks the exact capability, bound conversation,
 // live session, current account/permission and property. Reuse that authority for
 // read-only quotes instead of repeating outbound and inbound binding lookups.
 // An unbound call still has to establish its canonical provider identity first.
 const readContext=()=>d.db<CallOfferContext|null>('rpc/icash_call_offer_context','POST',{p_hash:hash,p_conversation:i.conversationId});
 let context=i.action==='get_offer'?await readContext():null;
 if(!context){await d.bind(token,i.conversationId);context=await readContext();}
 if(!context)return currentCallUnavailableOffer();
 if(context.party==='buyer')return i.action==='get_offer'?calculateAutomaticCallOffer(context,{},(d.now??Date.now)()):buyerAgreementHandoff();
 if(context.party!=='seller'||context.sellerContractSigned===true)return calculateAutomaticCallOffer(context,{},(d.now??Date.now)());
 const state:AutomaticOfferState={...context.offerState},snapshotHash=sha(JSON.stringify(canonical(context.snapshot))),now=(d.now??Date.now)();
 if(i.action==='accept_offer'&&!await d.verifyInput(i))return blockedOffer('acceptance_confirmation_required','Please confirm that the exact cash price we just discussed works for you.');
 if(i.action==='update_repairs'||i.action==='report_change'){
  const actual=await d.resolveStatement?.(i);if(actual)i.sellerStatement=actual;
  if(context.pendingAgreement)state.agreementRevisionRequired=true;
  const verified=await d.verifyInput(i);state.sellerStatement=verified?i.sellerStatement:'Statement confirmation required';state.acceptedPriceCents=null;
  if(i.action==='report_change'){
   const sellerPrice=verified?await d.verifySellerPrice?.(i):null;
   if(sellerPrice!=null){
    // Persist the correction even when unsupported, invalidating any earlier
    // acceptance. The calculation below independently enforces the ceiling.
    state.proposedPriceCents=sellerPrice;
   }else{
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
