import {calculateAutomaticCallOffer,offerPricePresentation,type AutomaticOfferState} from './automatic-call-offer.ts';
import {callOfferEvidence,callSellerPriceEvidence,sellerAskingPriceQuestion,spokenMoneyAmounts} from './call-offer-evidence.ts';
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
import {sellerRequestsPrice} from './seller-conversation-efficiency.ts';
import {sellerResponseDisposition} from './seller-response-policy.ts';
import {sellerCallInvitation,sellerCallTimeQuestion,sellerCallPreference,isDeliveredCallInvitation,isDeliveredCallQuestion,isCancelledUnsentSellerMessage,type SellerTextMessage} from './seller-call-preference.ts';
export {sellerCallInvitation} from './seller-call-preference.ts';

type Message=SellerTextMessage;
type Closing={legalName?:string;date?:string;inspection?:'yes'|'no'};
export type TextOfferState=AutomaticOfferState&{textThreadId?:string;closing?:Closing;processedSource?:string;pendingAskingPriceCents?:number};
export type TextOfferContext={accountId:string;jobId:string;threadId:string;sourceId:string;dealId:string;screeningId:string;phone:string;ownerUserId:string;ownerEmail:string;principal:string;address:string;snapshot:unknown;terms:unknown;offerState:TextOfferState|null;offerVersion:number;messages:Message[];history?:unknown[];fingerprint:string;activeCallSince?:string|null;callInvitationAllowed?:boolean};
export type TextOfferPlan={kind:'message'|'review'|'wait'|'agreement';action:string;body?:string;reason?:string;nextStep?:string;state:TextOfferState;terms?:DealTerms;confirmation?:SellerAgreementConfirmation};
const unqualifiedYes=(s:string)=>/^(?:yes|yeah|yep|sure|correct|okay|ok|that works|sounds good|i agree)[.! ,]*$/i.test(s.trim());
const no=(s:string)=>/^(?:no|nope|not yet)[.! ,]*$/i.test(s.trim());
const priceText=(n:number)=>offerPricePresentation(n).displayPrice;
function closingDateAnswer(body:string){
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 // A contract date must be an unqualified answer. Date.parse normalizes an
 // impossible named date (February 30) and must not choose our closing date.
 const answer=body.trim().replace(/[.!]+$/,'').replace(/^(?:(?:let['’]?s|we can|I can) close(?: on)?|(?:the )?closing date (?:is|should be)|I (?:would prefer|prefer))\s+/i,'').replace(/\s+(?:works(?: for me)?|please)$/i,'');
 const named=answer.match(/^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i);
 const month=named?months.findIndex(m=>m.toLowerCase()===named[1].toLowerCase()):-1;
 const date=named&&month>=0?`${named[3]}-${String(month+1).padStart(2,'0')}-${named[2].padStart(2,'0')}`:answer;
 return validCalendarDate(date)?date:undefined;
}

/** A bare “Sold” is a material ambiguity, not ownership or acceptance. Only a later explicit correction resolves it. */
function saleStatus(messages:Message[]):'sold'|'unclear'|null{
 let status:'sold'|'unclear'|null=null;
 for(const m of messages){
  if(m.direction==='outgoing')continue;
  if(m.direction!=='incoming'||m.state!=='received')continue;
  const b=m.body.replace(/[’‘]/g,"'").trim();
  if(/^(?:(?:no|actually|sorry)[, ]+)?(?:it (?:has not|hasn't|is not|isn't) sold(?: yet)?|(?:i|we) (?:still own (?:it|the (?:house|property))|haven't sold (?:it|the (?:house|property))(?: yet)?)|not sold(?: yet)?)[.! ]*$/i.test(b))status=null;
  else if(/^(?:i|we)(?: have| already| have already)? sold (?:it|the (?:house|property))[.! ]*$|^(?:it|the (?:house|property)) (?:has been |was |is )?(?:already )?sold[.! ]*$|^(?:i|we) no longer own (?:it|the (?:house|property))[.! ]*$/i.test(b))status='sold';
  else if(/^sold[.! ]*$/i.test(b))status='unclear';
 }
 return status;
}

/** Deterministic execution policy, not LLM prose. Each answer keeps its delivered
 * question, exact source, current underwriting and recipient. Asking is not acceptance. */
function ordinarySellerTextOffer(c:TextOfferContext,now:number):TextOfferPlan{
 const source=c.messages.find(m=>m.id===c.sourceId);
 const state:TextOfferState=structuredClone(c.offerState??{});
 const review=(reason:string,nextStep:string):TextOfferPlan=>({kind:'review',action:'review',reason,nextStep,state});
 if(c.activeCallSince){const held=review('active_call_receipt_unresolved','Wait for the active seller call and its original completion receipt before continuing by text.');return Date.parse(c.activeCallSince)>now-15*60000?{...held,kind:'wait',reason:'seller_call_active'}:held;}
 if(!source||source.direction!=='incoming'||source.state!=='received')return review('source_required','Reconcile the original seller message receipt.');
 const turns=c.messages.filter(m=>m.direction==='incoming'&&m.state==='received'||m.state==='delivered'&&m.providerId).flatMap((m,index,messages)=>{
  // An optional phone preference is not ownership, selling interest or a refusal
  // to keep texting. Reset the conversational question without altering receipts.
  if(isDeliveredCallQuestion(m))return [{role:'agent',message:''}];
  const prior=messages[index-1];
  if(m.direction==='incoming'&&isDeliveredCallQuestion(prior)&&/^(?:yes|yeah|yep|sure|okay|ok|no|nope|(?:just|only) text(?: me)?|text(?:ing)? only)[.! ]*$/i.test(m.body.trim()))return [];
  return [{role:m.direction==='incoming'?'user':'agent',message:m.body}];
 });
 const transcript={transcript:turns};
 const preceding=c.messages.slice(0,c.messages.indexOf(source));
 const previous=preceding.findLast(m=>m.direction==='outgoing');
 const unresolved=previous&&(!previous.providerId||previous.state!=='delivered')?previous:undefined;
 if(unresolved){
  const result=review('offer_receipt_unresolved','Reconcile the original outgoing receipt before interpreting this answer; do not resend.');
  if(['ready','accepted','dispatching'].includes(unresolved.state)&&Date.parse(unresolved.updatedAt??'')>now-15*60000)return {...result,kind:'wait',reason:'offer_receipt_pending'};
  return result;
 }
 const ask=(action:string,body:string):TextOfferPlan=>{
  const attempts=c.messages.filter(m=>m.direction==='outgoing'&&m.action===action&&m.state==='delivered');
  if(attempts.filter(m=>m.body===body).length>=2)return review('seller_answer_unclear',`The seller has not answered: ${body} Review their exact answer or arrange an authorized call.`);
  return {kind:'message',action,body,state};
 };
 // Keep the deterministic offer lane aligned with the source-word contact
 // policy. A refusal is not another invitation to repeat the same cash price.
 const disposition=sellerResponseDisposition(source.body);
 if(disposition){
  state.acceptedPriceCents=null;
  return review('seller_response_'+disposition,'Preserve the seller’s exact refusal, contact restriction or review request; do not continue the offer pitch.');
 }
 const sold=saleStatus(c.messages.slice(0,c.messages.indexOf(source)+1));
 if(sold)state.acceptedPriceCents=null;
 if(sold==='sold')return review('property_already_sold','The seller reports that the property sold. Stop the sale pitch and preserve their statement for review.');
 const input={action:'report_change',sellerStatement:source.body};
 const sellerPrice=callSellerPriceEvidence(transcript,input);
 if(state.textThreadId!==c.threadId){state.closing={};state.acceptedPriceCents=null;state.textThreadId=c.threadId;}
 const closing=state.closing??={};
 if(state.processedSource!==c.sourceId){
  const listing=sellerListingEvidence(transcript,input);if(listing!==null)state.listedWithAgent=listing;
  const debt=sellerPayoffEvidence(transcript,input);
  if(debt){state.payoffReport={...state.payoffReport,...debt};state.payoffPending=false;}
  if(sellerPrice!==null){state.proposedPriceCents=sellerPrice;if(sellerPrice!==state.quotedPriceCents)state.acceptedPriceCents=null;}
  if(sellerAskingPriceQuestion(source.body))state.acceptedPriceCents=null;
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
   closing.date=closingDateAnswer(source.body);
  }
  if(previous?.action==='inspection'&&(unqualifiedYes(source.body)||no(source.body)))closing.inspection=no(source.body)?'no':'yes';
 }
 state.processedSource=c.sourceId;
 if(sold==='unclear')return ask('clarify_sale_status','You mentioned it was sold. Are you still the owner, or has the sale already closed?');
 if(previous?.action==='cash_offer'&&no(source.body)){
  state.acceptedPriceCents=null;
  return ask('seller_counterprice','What price did you have in mind?');
 }
 if(state.pendingAskingPriceCents)return ask('clarify_gross_price','Do you mean the purchase price before any mortgage payoff, liens or closing adjustments?');
 if(/^(?:why|how).*(?:price|offer)|\b(?:too low|lowball)\b/i.test(source.body)&&state.quotedPriceCents)return ask('explain_cash_price',`The cash proposal reflects current value, repairs and holding costs. What property detail do you think the estimate is missing?`);
 if(previous?.action==='explain_cash_price'&&/\b(?:renovated|new roof|repaired|repairs?|square feet|bedrooms?|bathrooms?)\b/i.test(source.body))return ask('repair_budget','What is your estimate of the total remaining repair budget?');
 if(/^(?:who pays (?:the )?closing costs|(?:are there|what about|what are|any) (?:the |any )?fees)[?! .]*$/i.test(source.body))return ask('explain_costs','The purchase terms cover buyer-paid transaction closing costs. Seller debts and required charges are handled at closing; net proceeds need title confirmation.');
 if(/^(?:how (?:does|will) (?:this|it) work|what happens next)[?! .]*$/i.test(source.body))return ask('explain_process','We confirm property details and a cash price, agree on written terms, then coordinate signatures and title. What part would you like to discuss?');
 if(isDeliveredCallInvitation(preceding.at(-1))&&unqualifiedYes(source.body))return ask('invite_call_time',sellerCallTimeQuestion);
 const qualification=sellerOfferQualification(transcript,c.history??[],'sms');
 if(!qualification.ready){
  if(qualification.stop)return review('seller_qualification_stopped','Preserve the actual seller refusal, listing or ownership restriction.');
  const priceQuestion=sellerRequestsPrice(source.body);
  return ask('qualify_'+qualification.missing[0],(priceQuestion?'An offer depends on the property details. ':'')+qualification.nextQuestion);
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

/** Compute the ordinary negotiation step first. A channel suggestion may replace
 * only a next property-detail question, never an answer, quote or agreement step.
 * The service derives channel capability afresh; this is not calling authority. */
export function planSellerTextOffer(context:TextOfferContext,now=Date.now()):TextOfferPlan{
 const sourceIndex=context.messages.findIndex(m=>m.id===context.sourceId);
 const messages=sourceIndex<0||context.messages.filter(m=>m.id===context.sourceId).length!==1?[]:context.messages.slice(0,sourceIndex+1).filter(m=>!isCancelledUnsentSellerMessage(m));
 const c={...context,messages};
 const ordinary=ordinarySellerTextOffer(c,now);
 const source=messages.at(-1);
 if(c.callInvitationAllowed!==true||ordinary.kind!=='message'||!source
  ||!/^qualify_(?:situation|condition|occupancy|timing|listing)$|^repair_budget$/.test(ordinary.action)
  ||ordinary.state.quotedPriceCents||ordinary.state.acceptedPriceCents
  ||sellerRequestsPrice(source.body)||source.body.includes('?')
  ||/\b(?:price|offer|fees?|costs?|closing|contract|agreement|sign(?:ature)?|accept|counteroffer|net)\b/i.test(source.body)
  ||callSellerPriceEvidence({transcript:messages.filter(m=>m.direction==='incoming'&&m.state==='received'||m.direction==='outgoing'&&m.state==='delivered'&&m.providerId).map(m=>({role:m.direction==='incoming'?'user':'agent',message:m.body}))},{action:'report_change',sellerStatement:source.body})!==null)return ordinary;
 if(!sellerCallPreference(messages,c.sourceId).mayInvite)return ordinary;
 return {...ordinary,action:'invite_call',body:sellerCallInvitation};
}
