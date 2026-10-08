import {z} from 'zod';
import {runScreeningJob} from './screening-job.ts';
import {cashOfferCalculation} from './cash-offer-math.ts';
import {sellerCallFinancialGate} from './equity-screen.ts';
import {canonical,object,sha} from './required-call-recording.ts';

const conversationId=z.string().regex(/^conv_[A-Za-z0-9]+$/);
const cents=z.number().int().safe().nonnegative().max(100000000000);
export const automaticOfferInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('get_offer'),conversationId}).strict(),
 z.object({action:z.literal('accept_offer'),conversationId,priceCents:cents.positive(),quoteRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('update_repairs'),conversationId,sellerStatement:z.string().trim().min(3).max(1000),repairEstimateCents:cents.optional()}).strict(),
 z.object({action:z.literal('report_change'),conversationId,sellerStatement:z.string().trim().min(3).max(1000)}).strict(),
]);
export type AutomaticOfferState={repairEstimateCents?:number;conditionPending?:boolean;factsPending?:boolean;agreementRevisionRequired?:boolean;sellerStatement?:string;acceptedPriceCents?:number|null;quotedPriceCents?:number|null;quoteRevision?:string;snapshotHash?:string};
export type CallOfferContext={party:'seller'|'buyer'|'unknown';accountId?:string;dealId?:string;address?:string;snapshot?:unknown;terms?:unknown;pendingAgreement?:{priceCents:number;closingDate:string}|null;buyer?:{askingPriceCents:number;purchasePriceCents?:number;assignmentFeeCents?:number;address:string};offerState?:AutomaticOfferState|null;offerVersion?:number};
export const blockedOffer=(reason:string,instruction:string)=>({quoteAllowed:false as const,priceCents:null,reason,instruction});

/** Recompute in integer cents using the existing owner-selected formula. Seller
 * repair estimates remain unverified and never replace provider evidence. */
export function calculateAutomaticCallOffer(context:CallOfferContext,state:AutomaticOfferState,now=Date.now()){
 if(context.party==='buyer'){
  const b=context.buyer;
  if(!b||!Number.isSafeInteger(b.askingPriceCents)||b.askingPriceCents<=0)return blockedOffer('buyer_release_required','I need to confirm the current buyer package before quoting a price.');
  const breakdown=Number.isSafeInteger(b.purchasePriceCents)&&Number(b.purchasePriceCents)>0&&Number.isSafeInteger(b.assignmentFeeCents)&&Number(b.assignmentFeeCents)>=0&&Number(b.purchasePriceCents)+Number(b.assignmentFeeCents)===b.askingPriceCents?{purchasePriceCents:b.purchasePriceCents,assignmentFeeCents:b.assignmentFeeCents}:{};
  return {quoteAllowed:true as const,party:'buyer',priceCents:b.askingPriceCents,...breakdown,address:b.address,status:'approved_buyer_price',instruction:'Quote this exact total buyer price in dollars. The assignment fee is already included. Explain a numerical breakdown only if returned here. Use only the actual agreement for closing-cost terms.'};
 }
 if(context.party!=='seller'||!context.address)return blockedOffer('property_context_required','Which property are you calling about, and are you buying or selling?');
 if(state.agreementRevisionRequired)return blockedOffer('issued_agreement_changed','The changed property facts require revising the existing agreement before new terms can be confirmed.');
 if(state.factsPending)return blockedOffer('property_facts_changed','The updated ownership or payoff information needs to be reconciled before I can confirm a price.');
 if(state.conditionPending)return blockedOffer('repair_estimate_required','About how much do you estimate the total repairs will cost?');
 const pending=context.pendingAgreement;
 if(pending&&Number.isSafeInteger(pending.priceCents)&&pending.priceCents>0&&state.repairEstimateCents===undefined){
  return {quoteAllowed:true as const,party:'seller',priceCents:pending.priceCents,address:context.address,status:'pending_agreement',instruction:'Continue from this exact prepared agreement price and its saved terms. A verbal yes is not a signature.'};
 }
 try{
  const base=runScreeningJob(context.snapshot,now);
  if(base.property.address!==context.address)return blockedOffer('property_mismatch','I need to confirm the property record before quoting a price.');
  if(!base.offerAuthorized)return blockedOffer('financial_review_required','The mortgage and property numbers need to be reconciled before I can confirm a cash offer.');
  const providerRepairs=base.property.repairs.baselineCents;
  const repairs=state.repairEstimateCents===undefined?providerRepairs:providerRepairs===null?state.repairEstimateCents:Math.max(providerRepairs,state.repairEstimateCents);
  const calculation=cashOfferCalculation(base.property.estimatedMarketValueCents,repairs);
  const financial=sellerCallFinancialGate(base.property.financialScreening,{sellerOfferCents:calculation?.sellerCeilingCents??null,sellerCostReserveCents:Number.isSafeInteger(object(context.snapshot).sellerCostReserveCents)?Number(object(context.snapshot).sellerCostReserveCents):null,checkedAt:now});
  if(object(context.snapshot).propertyType!=='house'||financial.status!=='eligible'||!calculation?.sellerCeilingCents)return blockedOffer('financial_review_required','The mortgage and property numbers need to be reconciled before I can confirm a cash offer.');
  const agreed=state.acceptedPriceCents;
  if(agreed&&agreed>calculation.sellerCeilingCents)return blockedOffer('agreed_price_needs_update','The updated numbers do not support the previously discussed price. We need to reconcile that before confirming revised terms.');
  const price=agreed??calculation.sellerCeilingCents;
  return {quoteAllowed:true as const,party:'seller',priceCents:price,address:context.address,repairEstimateCents:repairs,repairSource:state.repairEstimateCents===undefined?'property_research':'seller_reported_total_budget',status:agreed?'verbally_accepted':'calculated_proposal',asIs:true,payment:'cash',instruction:agreed?'Keep this exact verbally accepted price and continue the remaining closing confirmations.':'Present this exact nonbinding as-is cash purchase price after qualification. Do not promise net proceeds or invent adjustments.'};
 }catch{return blockedOffer('current_research_required','The property research needs updating before I can confirm a cash offer.');}
}

type Db=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Db;bind:(token:string,conversationId:string)=>Promise<void>;verifyInput:(input:Record<string,unknown>)=>Promise<boolean>;now?:()=>number};
export async function automaticCallOffer(token:string,input:unknown,d:Dependencies){
 const i=automaticOfferInput.parse(input),hash=sha(token);await d.bind(token,i.conversationId);
 const context=await d.db<CallOfferContext|null>('rpc/icash_call_offer_context','POST',{p_hash:hash,p_conversation:i.conversationId});
 if(!context)return blockedOffer('current_call_required','I need to confirm the current property context before quoting a price.');
 if(context.party==='buyer')return i.action==='get_offer'?calculateAutomaticCallOffer(context,{},(d.now??Date.now)()):blockedOffer('buyer_terms_locked','The buyer price comes from the current under-contract package; changed terms need review.');
 if(context.party!=='seller')return calculateAutomaticCallOffer(context,{},(d.now??Date.now)());
 const state:AutomaticOfferState={...context.offerState},snapshotHash=sha(JSON.stringify(canonical(context.snapshot))),now=(d.now??Date.now)();
 if(i.action==='accept_offer'&&!await d.verifyInput(i))return blockedOffer('acceptance_confirmation_required','Please confirm that the exact cash price we just discussed works for you.');
 if(i.action==='update_repairs'||i.action==='report_change'){
  if(context.pendingAgreement)state.agreementRevisionRequired=true;
  const verified=await d.verifyInput(i);state.sellerStatement=verified?i.sellerStatement:'Statement confirmation required';state.acceptedPriceCents=null;
  if(i.action==='report_change')state.factsPending=true;
  else {state.conditionPending=!verified||i.repairEstimateCents===undefined;if(verified&&i.repairEstimateCents!==undefined)state.repairEstimateCents=i.repairEstimateCents;}
 }
 const offer=calculateAutomaticCallOffer(context,state,now);
 const revision=sha(JSON.stringify(canonical({snapshotHash,repairs:state.repairEstimateCents??null,conditionPending:!!state.conditionPending,factsPending:!!state.factsPending,priceCents:offer.priceCents})));
 if(i.action==='accept_offer'){
  if(!offer.quoteAllowed||offer.party!=='seller'||i.priceCents!==offer.priceCents||i.quoteRevision!==revision||state.quoteRevision!==revision||state.quotedPriceCents!==i.priceCents)return blockedOffer('quote_changed','The saved quote changed. Let me confirm the current amount before we agree to it.');
  state.acceptedPriceCents=i.priceCents;
 }
 state.snapshotHash=snapshotHash;state.quotedPriceCents=offer.priceCents;state.quoteRevision=revision;
 const saved=await d.db<boolean>('rpc/icash_save_call_offer','POST',{p_hash:hash,p_conversation:i.conversationId,p_expected_version:context.offerVersion??0,p_expected_snapshot:context.snapshot,p_state:state,p_action:i.action});
 if(saved!==true)return blockedOffer('quote_changed','The property record changed while I checked. Let me get the current calculation.');
 return {...offer,quoteRevision:revision,...(i.action==='accept_offer'?{status:'verbally_accepted',instruction:'Verbal acceptance saved at this exact price. Continue closing date, legal name, owners, inspection preference and prepared terms, then confirm_and_send. This is not a signature.'}:{})};
}
