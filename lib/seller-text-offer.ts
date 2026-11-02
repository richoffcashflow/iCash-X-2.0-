import {calculateAutomaticCallOffer,offerPricePresentation,type AutomaticOfferState} from './automatic-call-offer.ts';
import {callOfferEvidence,callSellerPriceEvidence,spokenMoneyAmounts} from './call-offer-evidence.ts';
import {sellerOfferQualification} from './seller-offer-qualification.ts';
import {sellerPayoffEvidence} from './seller-payoff.ts';
import {sellerListingEvidence} from './seller-listing.ts';
import {sellerAgreementIdentityEvidence,sellerAgreementIdentityHold} from './seller-agreement-identity.ts';
import {sellerAgreementEvidence} from './seller-agreement-evidence.ts';
import {confirmedSellerTerms,type SellerAgreementConfirmation} from './seller-agreement-flow.ts';
import {dealTermsSchema,type DealTerms} from './deal-documents.ts';
import {validCalendarDate} from './document-dates.ts';
import {runScreeningJob} from './screening-job.ts';
import {canonical,sha} from './required-call-recording.ts';

type Message={id:string;direction:string;body:string;state:string;providerId:string|null;updatedAt?:string;action?:string;quoteRevision?:string;priceCents?:number;customerAuthored?:boolean};
type Closing={legalName?:string;date?:string;inspection?:'yes'|'no'};
export type TextOfferState=AutomaticOfferState&{textThreadId?:string;closing?:Closing;processedSource?:string;pendingAskingPriceCents?:number};
export type TextOfferContext={accountId:string;jobId:string;threadId:string;sourceId:string;dealId:string;screeningId:string;phone:string;ownerUserId:string;ownerEmail:string;principal:string;address:string;snapshot:unknown;terms:unknown;offerState:TextOfferState|null;offerVersion:number;messages:Message[];history?:unknown[];fingerprint:string;activeCallSince?:string|null};
export type TextOfferPlan={kind:'message'|'review'|'wait'|'agreement';action:string;body?:string;reason?:string;nextStep?:string;state:TextOfferState;terms?:DealTerms;confirmation?:SellerAgreementConfirmation};
const unqualifiedYes=(s:string)=>/^(?:yes|yeah|yep|sure|correct|okay|ok|that works|sounds good|i agree)[.! ,]*$/i.test(s.trim());
const no=(s:string)=>/^(?:no|nope|not yet)[.! ,]*$/i.test(s.trim());
const priceText=(n:number)=>offerPricePresentation(n).displayPrice;

/** Deterministic execution policy, not LLM prose. Each answer keeps its delivered
 * question, exact source, current underwriting and recipient. Asking is not acceptance. */
export function planSellerTextOffer(c:TextOfferContext,now=Date.now()):TextOfferPlan{
 const source=c.messages.find(m=>m.id===c.sourceId);
 const state:TextOfferState=structuredClone(c.offerState??{});
 const review=(reason:string,nextStep:string):TextOfferPlan=>({kind:'review',action:'review',reason,nextStep,state});
 if(c.activeCallSince){const held=review('active_call_receipt_unresolved','Wait for the active seller call and its original completion receipt before continuing by text.');return Date.parse(c.activeCallSince)>now-15*60000?{...held,kind:'wait',reason:'seller_call_active'}:held;}
 if(!source||source.direction!=='incoming'||source.state!=='received')return review('source_required','Reconcile the original seller message receipt.');
 const turns=c.messages.filter(m=>m.direction==='incoming'||m.state==='delivered'&&m.providerId).map(m=>({role:m.direction==='incoming'?'user':'agent',message:m.body}));
 const transcript={transcript:turns};
 const previous=c.messages.slice(0,c.messages.indexOf(source)).findLast(m=>m.direction==='outgoing');
 if(previous&&(!previous.providerId||previous.state!=='delivered')){
  const result=review('offer_receipt_unresolved','Reconcile the original outgoing receipt before interpreting this answer; do not resend.');
  if(['ready','accepted','dispatching'].includes(previous.state)&&Date.parse(previous.updatedAt??'')>now-15*60000)return {...result,kind:'wait',reason:'offer_receipt_pending'};
  return result;
 }
 const ask=(action:string,body:string):TextOfferPlan=>{
  const attempts=c.messages.filter(m=>m.direction==='outgoing'&&m.action===action&&m.state==='delivered');
  if(attempts.filter(m=>m.body===body).length>=2)return review('seller_answer_unclear',`The seller has not answered: ${body} Review their exact answer or arrange an authorized call.`);
  return {kind:'message',action,body,state};
 };
 const input={action:'report_change',sellerStatement:source.body};
 const sellerPrice=callSellerPriceEvidence(transcript,input);
 if(state.textThreadId!==c.threadId){state.closing={};state.acceptedPriceCents=null;state.textThreadId=c.threadId;}
 const closing=state.closing??={};
 if(state.processedSource!==c.sourceId){
  const listing=sellerListingEvidence(transcript,input);if(listing!==null)state.listedWithAgent=listing;
  const debt=sellerPayoffEvidence(transcript,input);
  if(debt){state.payoffReport={...state.payoffReport,...debt};state.payoffPending=false;}
  if(sellerPrice!==null){state.proposedPriceCents=sellerPrice;if(sellerPrice!==state.quotedPriceCents)state.acceptedPriceCents=null;}
  if(/\b(?:changed my mind|do not accept|don['’]?t accept|withdraw|cancel|hold off|wait|only if|but I need)\b/i.test(source.body))state.acceptedPriceCents=null;
  // Material changes invalidate acceptance; clear only with actual new evidence.
  if(/\b(?:wrong (?:property|address)|another owner|ownership changed|fire damage|foundation (?:damage|problem)|new (?:damage|repair))\b/i.test(source.body)){state.acceptedPriceCents=null;state.factsPending=true;}
  const amounts=spokenMoneyAmounts(source.body);
  if(previous?.action==='clarify_gross_price'&&unqualifiedYes(source.body)&&state.pendingAskingPriceCents){state.proposedPriceCents=state.pendingAskingPriceCents;delete state.pendingAskingPriceCents;}
  if(/\b(?:if|unless|provided|but|net|after fees)\b/i.test(source.body)&&!['payoff','owners'].includes(previous?.action??'')){
   state.acceptedPriceCents=null;
   if(amounts.length===1&&/\b(?:net|after fees|take home)\b/i.test(source.body))state.pendingAskingPriceCents=amounts[0];
  }
  if(previous?.action==='repair_budget'&&amounts.length===1&&callOfferEvidence(transcript,{action:'update_repairs',sellerStatement:source.body,repairEstimateCents:amounts[0]})){state.repairEstimateCents=amounts[0];state.conditionPending=false;state.acceptedPriceCents=null;}
  if(previous?.action==='legal_name'){
   const name=source.body.trim().replace(/^(?:my (?:full |legal |full legal )?name is|I am|I'm)\s+/i,'').replace(/[.!]+$/,'');
   if(/^[\p{L}][\p{L} .’'-]{1,119}$/u.test(name)&&name.split(/\s+/).length>=2&&!/\b(?:unknown|not sure|no|yes|maybe|trust|llc|corporation)\b/i.test(name))closing.legalName=name;
  }
  if(previous?.action==='closing_date'){
   const named=source.body.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? \d{4}\b/i)?.[0];
   const date=source.body.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]??(named&&Number.isFinite(Date.parse(named))?new Date(named).toISOString().slice(0,10):undefined);
   if(date&&validCalendarDate(date))closing.date=date;
  }
  if(previous?.action==='inspection'&&(unqualifiedYes(source.body)||no(source.body)))closing.inspection=no(source.body)?'no':'yes';
 }
 state.processedSource=c.sourceId;
 if(state.pendingAskingPriceCents)return ask('clarify_gross_price','Do you mean the purchase price before any mortgage payoff, liens or closing adjustments?');
 if(/^(?:why|how).*(?:price|offer)|\b(?:too low|lowball)\b/i.test(source.body)&&state.quotedPriceCents)return ask('explain_cash_price',`The cash proposal reflects current value, repairs and holding costs. What property detail do you think the estimate is missing?`);
 if(previous?.action==='explain_cash_price'&&/\b(?:renovated|new roof|repaired|repairs?|square feet|bedrooms?|bathrooms?)\b/i.test(source.body))return ask('repair_budget','What is your estimate of the total remaining repair budget?');
 if(/^(?:who pays (?:the )?closing costs|(?:are there|what about|what are|any) (?:the |any )?fees)[?! .]*$/i.test(source.body))return ask('explain_costs','The purchase terms cover buyer-paid transaction closing costs. Seller debts and required charges are handled at closing; net proceeds need title confirmation.');
 if(/^(?:how (?:does|will) (?:this|it) work|what happens next)[?! .]*$/i.test(source.body))return ask('explain_process','We confirm property details and a cash price, agree on written terms, then coordinate signatures and title. What part would you like to discuss?');
 const qualification=sellerOfferQualification(transcript,c.history??[]);
 if(!qualification.ready){
  if(qualification.stop)return review('seller_qualification_stopped','Preserve the actual seller refusal, listing or ownership restriction.');
  return ask('qualify_'+qualification.missing[0],qualification.nextQuestion);
 }
 const offer=calculateAutomaticCallOffer({party:'seller',address:c.address,snapshot:c.snapshot},state,now);
 if(!offer.quoteAllowed){
  if(offer.reason==='repair_estimate_required')return ask('repair_budget','What is your estimate of the total repair budget?');
  return review(offer.reason,offer.instruction);
 }
 const contractAllowed='contractAllowed' in offer&&offer.contractAllowed===true;
 const revision=sha(JSON.stringify(canonical({snapshot:c.snapshot,price:offer.priceCents,repairs:state.repairEstimateCents??null,payoff:state.payoffReport??null,contractAllowed})));
 const quotedBefore=previous?.action==='cash_offer'&&previous.priceCents===offer.priceCents&&previous.quoteRevision===revision;
 const exactPriceAnswer=sellerPrice===offer.priceCents&&/works for me/i.test(source.body);
 if(quotedBefore&&(callOfferEvidence({transcript:turns.slice(-2)},{action:'accept_offer',priceCents:offer.priceCents})||exactPriceAnswer)){
  state.acceptedPriceCents=offer.priceCents;state.acceptanceConditional=!contractAllowed;
 }
 if(state.quoteRevision!==revision&&state.quoteRevision){state.acceptedPriceCents=null;state.acceptanceConditional=false;}
 state.quotedPriceCents=offer.priceCents;state.quoteRevision=revision;state.contractBlocked=!contractAllowed;state.snapshotHash=sha(JSON.stringify(canonical(c.snapshot)));
 if(!contractAllowed){
  const next='nextQuestion' in offer&&typeof offer.nextQuestion==='string'?offer.nextQuestion:'What is the current mortgage payoff balance?';
  if(previous?.action==='payoff'&&/\b(?:don't know|do not know|not sure)\b/i.test(source.body))return review('payoff_evidence_required','Obtain the actual outstanding debt information before sending the agreement. The cash proposal remains conditional.');
  return ask('payoff',`${!c.messages.some(m=>m.action==='payoff')?`As-is cash proposal: ${priceText(offer.priceCents)}, subject to payoff and liens. `:''}${next}`);
 }
 if(!state.acceptedPriceCents||state.acceptanceConditional){
  const counter=sellerPrice!==null&&sellerPrice>offer.priceCents?`You asked ${priceText(sellerPrice)}. `:'';
  return ask('cash_offer',`${counter}Our as-is cash proposal is ${priceText(offer.priceCents)}, based on property value, repairs and holding costs. Does that work?`);
 }
 const identity=sellerAgreementIdentityEvidence(transcript,closing.legalName??'');
 const identityHold=sellerAgreementIdentityHold(identity);
 if(identityHold){
  if(identity.otherSignersRequired)return ask('other_signers','Who else needs to agree or sign, and how can they take part in confirming the terms?');
  return ask(identity.legalNameConfirmed?'owners':'legal_name',identityHold.nextQuestion);
 }
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!closing.date||closing.date<=today||Date.parse(closing.date+'T12:00:00Z')>now+366*86400000)return ask('closing_date','What exact closing date works for you, including the year?');
 if(!closing.inspection)return ask('inspection',"We'd like to inspect the property before closing. Would that work for you?");
 const confirmation:SellerAgreementConfirmation={sellerLegalName:closing.legalName!,agreedPriceCents:state.acceptedPriceCents,closingDate:closing.date,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:closing.inspection,priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
 let terms:DealTerms;
 try{
  const research=runScreeningJob(c.snapshot,now);
  terms=confirmedSellerTerms(dealTermsSchema.parse(c.terms),confirmation,{address:c.address,principal:c.principal,legalDescription:research.property.legalDescription??'',ceilingCents:offer.priceCents,now,supportedRenegotiation:true});
 }catch{return review('contract_terms_required','Resolve the specific missing or changed property/contract terms before preparing this accepted proposal.');}
 if(!sellerAgreementEvidence(transcript,terms,now))return ask('confirm_terms',`${priceText(terms.priceCents!)} cash; closing ${terms.closingDate}; ${terms.inspectionDays}-day inspection. Do these terms work, and may I text the agreement now?`);
 return {kind:'agreement',action:'prepare_agreement',state,terms,confirmation};
}
