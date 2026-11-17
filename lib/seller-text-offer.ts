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
import {sellerConversionIntent} from './seller-conversion-intent.ts';
import {sellerCommunicationIntent,sellerCommunicationReplies} from './seller-communication-intent.ts';
import {sellerIdentityInterruption} from './seller-answer-evidence.ts';
import {chronologicalSellerHistory} from './seller-memory.ts';
import {sellerQuestion} from './seller-question-evidence.ts';

type Message={id:string;direction:string;body:string;state:string;providerId:string|null;at?:string;updatedAt?:string;action?:string;quoteRevision?:string;priceCents?:number;customerAuthored?:boolean};
type Closing={legalName?:string;date?:string;inspection?:'yes'|'no'};
export type TextOfferState=AutomaticOfferState&{textThreadId?:string;closing?:Closing;processedSource?:string;pendingAskingPriceCents?:number};
export type TextOfferContext={accountId:string;jobId:string;threadId:string;sourceId:string;dealId:string;screeningId:string;phone:string;ownerUserId:string;ownerEmail:string;principal:string;address:string;snapshot:unknown;terms:unknown;offerState:TextOfferState|null;offerVersion:number;messages:Message[];history?:unknown[];historyComplete?:boolean;fingerprint:string;memoryFingerprint?:string;conversionEnabled?:boolean;activeCallSince?:string|null;callInvitationAllowed?:boolean};
export type TextOfferPlan={kind:'message'|'review'|'wait'|'agreement';action:string;body?:string;reason?:string;nextStep?:string;state:TextOfferState;terms?:DealTerms;confirmation?:SellerAgreementConfirmation};
const unqualifiedYes=(s:string)=>/^(?:yes|yeah|yep|sure|correct|okay|ok|that works|sounds good|i agree)[.! ,]*$/i.test(s.trim());
const no=(s:string)=>/^(?:no|nope|not yet)[.! ,]*$/i.test(s.trim());
const priceText=(n:number)=>offerPricePresentation(n).displayPrice;
/** Only these fixed informational replies change wording. Keep earlier delivered
 * versions equivalent for the existing repeat limit; never rewrite history. */
const sellerAnswerCopy:Record<string,{current:string;previous:string}>={
 explain_cash_price:{current:'Our cash proposal factors in property value, repairs and holding costs. What recent work or other detail should we take into account?',previous:'The cash proposal reflects current value, repairs and holding costs. What property detail do you think the estimate is missing?'},
 explain_costs:{current:'The buyer pays transaction closing costs. Mortgages, liens and required seller charges can reduce your payout; the title company must confirm the final amount.',previous:'The purchase terms cover buyer-paid transaction closing costs. Seller debts and required charges are handled at closing; net proceeds need title confirmation.'},
 explain_process:{current:'We check the property details, agree on a cash price and written terms, then sign. The title company checks ownership and handles closing.',previous:'We confirm property details and a cash price, agree on written terms, then coordinate signatures and title. What part would you like to discuss?'},
};
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

/** Reuse only actual answers to closing questions. These are conversational
 * values; the final exact terms readback and delivery request remain required. */
function rememberedClosing(history:unknown[]):Closing{
 const closing:Closing={};
 for(const conversation of history){
  const rows=(conversation as {transcript?:{role:string;message?:string}[]})?.transcript;
  if(!Array.isArray(rows))continue;let question='';
  for(const row of rows){
   if(typeof row.message!=='string')continue;
   if(row.role==='agent'){question=sellerQuestion(row.message);continue;}
   if(row.role!=='user')continue;
   if(/\b(?:i(?:'m| am) (?:his|her|their) (?:wife|husband|son|daughter|tenant)|i(?:'m| am) (?:the |a )?tenant)\b/i.test(row.message)){closing.legalName=undefined;closing.inspection=undefined;}
   if(/\b(?:full|legal) name\b/i.test(question)&&question.includes('?')&&!sellerIdentityInterruption(row.message)&&!unqualifiedYes(row.message)){
    const name=row.message.trim().replace(/^(?:my (?:full |legal |full legal )?name is|I am|I'm)\s+/i,'').replace(/[.!]+$/,'');
    closing.legalName=/^[\p{L}][\p{L} .’'-]{1,119}$/u.test(name)&&name.split(/\s+/).length>=2&&!/\b(?:unknown|not|sure|no|yes|maybe|trust|llc|corporation|email|call)\b/i.test(name)?name:undefined;
   }
   if(/\b(?:closing date|what.*date.*clos|when.*clos(?:e|ing))\b/i.test(question)&&question.includes('?')&&!sellerIdentityInterruption(row.message))closing.date=closingDateAnswer(row.message);
   if(/\b(?:inspect|inspection)\b/i.test(question)&&question.includes('?')&&(unqualifiedYes(row.message)||no(row.message)))closing.inspection=no(row.message)?'no':'yes';
  }
 }
 return closing;
}

/** A preference question is not a booking or new calling authority. Keep the
 * existing exact callback wording so a subsequent “now” reaches its established
 * source-bound call workflow. Missing channel eligibility fails closed. */
export const sellerCallInvitation='When is a good time to talk about a cash offer?';
function isDeliveredCallInvitation(message:Message|undefined){
 return message?.direction==='outgoing'&&message.state==='delivered'&&!!message.providerId
  &&(message.action==='invite_call'||message.body===sellerCallInvitation);
}
function priorCallPreference(messages:Message[]){
 return messages.some(m=>m.direction==='outgoing'&&(m.action==='invite_call'||/\b(?:when|what (?:date|day|time)|good time|available).*\b(?:call|talk)\b|\bcan (?:i|we) call\b/i.test(m.body))
  ||m.direction==='incoming'&&/\b(?:text(?:ing)? only|only text|(?:just|rather|prefer(?: to)?) (?:keep )?text(?:ing)?|(?:keep|stay) (?:it |this )?(?:on|over|to|in) text|(?:keep|prefer) texting|(?:just|please) text me|rather not (?:talk|call)|(?:cannot|can't) (?:talk|take calls)|call me|call back|callback|phone call|(?:can|could|may) i call)\b/i.test(m.body));
}
/** Exact answers to a delivered budget question can describe condition or say
 * no estimate is available. They never establish a numeric repair allowance. */
function repairDescriptionWithoutBudget(body:string){
 const text=body.replace(/[’‘]/g,"'").trim();
 return /^(?:(?:i|we) (?:don't|do not) know(?: (?:the )?(?:repair )?(?:budget|cost|estimate))?|(?:i'm |i am |we're |we are )?not sure(?: (?:of|about) (?:the )?(?:repair )?(?:budget|cost|estimate))?|(?:i|we) (?:don't|do not) have (?:a |an )?(?:repair )?(?:budget|estimate)|(?:i|we)(?:'d| would) rather not (?:say|guess|estimate)|no (?:idea|estimate))[.! ]*$/i.test(text)
  || /^(?:(?:it |the (?:house|property) )?(?:needs? no repairs|does(?:n't| not) need (?:any )?repairs)|no repairs(?: (?:are )?(?:needed|required))?|(?:it |the (?:house|property) )?(?:is in good (?:shape|condition)|needs? (?:a |an |some |new )?(?:roof|paint|updates|work|repairs)))[.! ]*$/i.test(text);
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
export function planSellerTextOffer(c:TextOfferContext,now=Date.now()):TextOfferPlan{
 const source=c.messages.find(m=>m.id===c.sourceId);
 const state:TextOfferState=structuredClone(c.offerState??{});
 if(state.acceptedPriceCents===undefined)state.acceptedPriceCents=null;
 const review=(reason:string,nextStep:string):TextOfferPlan=>({kind:'review',action:'review',reason,nextStep,state});
 if(c.activeCallSince){const held=review('active_call_receipt_unresolved','Wait for the active seller call and its original completion receipt before continuing by text.');return Date.parse(c.activeCallSince)>now-15*60000?{...held,kind:'wait',reason:'seller_call_active'}:held;}
 if(!source||source.direction!=='incoming'||source.state!=='received')return review('source_required','Reconcile the original seller message receipt.');
 const intent=sellerConversionIntent(source.body);
 const turns=c.messages.filter(m=>m.direction==='incoming'||m.state==='delivered'&&m.providerId).flatMap((m,index,messages)=>{
  // An optional phone preference is not ownership, selling interest or a refusal
  // to keep texting. Reset the conversational question without altering receipts.
  if(isDeliveredCallInvitation(m))return [{role:'agent',message:''}];
  const prior=messages.slice(0,index).findLast(turn=>turn.direction==='outgoing');
  if(m.direction==='incoming'&&isDeliveredCallInvitation(prior)&&/^(?:yes|yeah|yep|sure|okay|ok|no|nope|(?:just|only) text(?: me)?|text(?:ing)? only)[.! ]*$/i.test(m.body.trim()))return [];
  return [{role:m.direction==='incoming'?'user':'agent',message:m.body,...(m.at?{at:m.at,sourceId:m.id}:{})}];
 });
 const transcript={transcript:turns};
 // Canonical memory already includes this thread. Appending its entire history
 // again would move an old SMS answer after a newer call correction.
 const conversationHistory=c.historyComplete?c.history??[]:c.messages.every(m=>m.at)&&c.history?.length
  ?chronologicalSellerHistory([...c.history,{sourceId:'sms',channel:'sms',...transcript}])
  :[...(c.history??[]),transcript];
 const previous=c.messages.slice(0,c.messages.indexOf(source)).findLast(m=>m.direction==='outgoing');
 // Complete memory carries the original received answer and its verified
 // question. A later delivered flag must not lend a question that arrived
 // after the answer; preserve the entire question for price/readback evidence.
 const canonicalSources=(c.history??[]).flatMap(value=>{
  const rows=(value as {transcript?:{role:string;message?:string;sourceId?:string;questionUnverified?:boolean}[]})?.transcript;
  if(!Array.isArray(rows))return [];
  return rows.flatMap((turn,index)=>turn.role==='user'&&turn.sourceId===source.id?[{turn,question:rows.slice(0,index).findLast(t=>t.role==='agent')?.message??''}]:[]);
 });
 const canonicalSource=canonicalSources.length===1&&canonicalSources[0].turn.message===source.body?canonicalSources[0]:null;
 if(c.historyComplete&&!canonicalSource){
  state.receiptPriceAuthority??={sourceId:c.sourceId,priceCents:state.acceptedPriceCents??null,...(state.quoteRevision?{quoteRevision:state.quoteRevision}:{})};
  return review('seller_source_evidence_required','Reconcile the exact original current seller reply before interpreting its price or contract authority.');
 }
 const questionKnown=!c.historyComplete||!!canonicalSource&&canonicalSource.turn.questionUnverified!==true;
 const questionPrevious=questionKnown&&(!c.historyComplete||canonicalSource!.question===previous?.body)?previous:undefined;
 const sourceTranscript=c.historyComplete?{transcript:[{role:'agent',message:questionKnown?canonicalSource!.question:''},{role:'user',message:source.body}]}:transcript;
 if(previous&&(!previous.providerId||previous.state!=='delivered')){
  const result=review('offer_receipt_unresolved','Reconcile the original outgoing receipt before interpreting this answer; do not resend.');
  if(['ready','accepted','dispatching'].includes(previous.state)&&Date.parse(previous.updatedAt??'')>now-15*60000)return {...result,kind:'wait',reason:'offer_receipt_pending'};
  return result;
 }
 let replyIntro='';
 const ask=(action:string,body:string):TextOfferPlan=>{
  if(replyIntro){
   if(action==='cash_offer'&&state.quotedPriceCents)body=`As-is cash proposal: ${priceText(state.quotedPriceCents)}. Does that work?`;
   body=replyIntro+' '+body;
   if(body.length>160)return review('buyer_identity_copy_required','The full saved buyer identity and answer must fit the reviewed text rate.');
  }
  const attempts=c.messages.filter(m=>m.direction==='outgoing'&&m.action===action&&m.state==='delivered');
  const revised=sellerAnswerCopy[action];
  if(attempts.filter(m=>m.body===body||(revised&&body===revised.current&&m.body===revised.previous)).length>=2)return review('seller_answer_unclear',`The seller has not answered: ${body} Review their exact answer or arrange an authorized call.`);
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
 const communication=sellerCommunicationIntent(source.body);
 if(questionPrevious?.action==='communication_language'&&communication!=='return_call')return review('seller_language_support_required','Continue in the seller-requested language through supported assistance; do not restart English qualification.');
 if(questionPrevious?.action==='communication_email'&&!communication)return review('seller_email_delivery_required','Use a verified, permitted email contact and supported delivery for the requested details or agreement. Do not substitute an SMS agreement or claim email delivery.');
 if(communication)return ask('communication_'+communication,sellerCommunicationReplies[communication]);
 const qualification=sellerOfferQualification(null,conversationHistory,'sms');
 // Unknown question timing holds price/signing authority, but a verified
 // current reply can still receive a bounded clarification through normal SMS
 // admission. Refusals, listing restrictions and unresolved sends stay held.
 if(!qualification.ready&&qualification.clarificationRequired===true){
  state.textThreadId=c.threadId;state.processedSource=c.sourceId;
  state.receiptPriceAuthority??={sourceId:c.sourceId,priceCents:state.acceptedPriceCents??null,...(state.quoteRevision?{quoteRevision:state.quoteRevision}:{})};
  return ask('clarify_source_answer',qualification.nextQuestion);
 }
 if(!qualification.ready&&qualification.stop)return review('seller_qualification_stopped','Preserve the actual seller refusal, listing or ownership restriction.');
 const sellerPrice=callSellerPriceEvidence(sourceTranscript,input);
 // The server binds this shared ledger to the same account, deal and current
 // research. A channel switch is not a withdrawal or a new price.
 if(state.textThreadId!==c.threadId)state.textThreadId=c.threadId;
 const closing=state.closing={...state.closing,...rememberedClosing(conversationHistory)};
 if(state.processedSource!==c.sourceId){
  const listing=sellerListingEvidence(sourceTranscript,input);if(listing!==null)state.listedWithAgent=listing;
  const debt=sellerPayoffEvidence(sourceTranscript,input);
  if(debt){state.payoffReport={...state.payoffReport,...debt};state.payoffPending=false;}
  if(sellerPrice!==null){state.proposedPriceCents=sellerPrice;if(sellerPrice!==state.quotedPriceCents)state.acceptedPriceCents=null;}
  if(sellerAskingPriceQuestion(source.body))state.acceptedPriceCents=null;
  if(/\b(?:changed my mind|do not accept|don['’]?t accept|(?:i|we) (?:reject|decline|refuse)|withdraw|cancel|hold off|wait|only if|but I need)\b/i.test(source.body))state.acceptedPriceCents=null;
  // Material changes invalidate acceptance; clear only with actual new evidence.
  if(/\b(?:wrong (?:property|address)|another owner|ownership changed|fire damage|foundation (?:damage|problem)|new (?:damage|repair))\b/i.test(source.body)){state.acceptedPriceCents=null;state.factsPending=true;}
  const amounts=spokenMoneyAmounts(source.body);
  if(questionPrevious?.action==='clarify_gross_price'&&unqualifiedYes(source.body)&&state.pendingAskingPriceCents){state.proposedPriceCents=state.pendingAskingPriceCents;delete state.pendingAskingPriceCents;}
  if(/\b(?:if|unless|provided|but|net|after fees)\b/i.test(source.body)&&!['payoff','owners'].includes(questionPrevious?.action??'')){
   state.acceptedPriceCents=null;
   if(amounts.length===1&&/\b(?:net|after fees|take home)\b/i.test(source.body))state.pendingAskingPriceCents=amounts[0];
  }
  if(questionPrevious?.action==='repair_budget'&&amounts.length<=1){
   // The amount parser omits a spoken "zero". The shared evidence guard may
   // accept it only as an exact answer to the delivered total-repair question.
   const repairBudget=amounts.length===1?amounts[0]:0;
   if(callOfferEvidence(sourceTranscript,{action:'update_repairs',sellerStatement:source.body,repairEstimateCents:repairBudget})){state.repairEstimateCents=repairBudget;state.conditionPending=false;state.acceptedPriceCents=null;state.sellerStatement=source.body;}
   else if(amounts.length===0&&repairDescriptionWithoutBudget(source.body)){
    let researchRepairs:number|null=null;try{researchRepairs=runScreeningJob(c.snapshot,now).property.repairs.baselineCents;}catch{}
    if(researchRepairs!==null&&Number.isSafeInteger(researchRepairs)&&researchRepairs>=0){
     // Retain research and any prior seller allowance. Do not invent zero,
     // lower the offer calculation's reserve or clear unrelated fact holds.
     state.conditionPending=false;state.sellerStatement=source.body;state.acceptedPriceCents=null;
    }
   }
  }
  if(questionPrevious?.action==='legal_name'&&intent===null&&!sellerIdentityInterruption(source.body)){
   const name=source.body.trim().replace(/^(?:my (?:full |legal |full legal )?name is|I am|I'm)\s+/i,'').replace(/[.!]+$/,'');
   if(/^[\p{L}][\p{L} .’'-]{1,119}$/u.test(name)&&name.split(/\s+/).length>=2&&!/\b(?:unknown|not sure|no|yes|maybe|trust|llc|corporation)\b/i.test(name))closing.legalName=name;
  }
  if(questionPrevious?.action==='closing_date'&&!sellerIdentityInterruption(source.body)){
   closing.date=closingDateAnswer(source.body);
  }
  if(questionPrevious?.action==='inspection'&&(unqualifiedYes(source.body)||no(source.body)))closing.inspection=no(source.body)?'no':'yes';
 }
 state.processedSource=c.sourceId;
 if(sold==='unclear')return ask('clarify_sale_status','You mentioned it was sold. Are you still the owner, or has the sale already closed?');
 if(questionPrevious?.action==='cash_offer'&&no(source.body)){
  state.acceptedPriceCents=null;
  return ask('seller_counterprice','What price did you have in mind?');
 }
 if(state.pendingAskingPriceCents)return ask('clarify_gross_price','Do you mean the purchase price before any mortgage payoff, liens or closing adjustments?');
 if(/^(?:why|how).*(?:price|offer)|\b(?:too low|lowball)\b/i.test(source.body)&&state.quotedPriceCents)return ask('explain_cash_price',sellerAnswerCopy.explain_cash_price.current);
 if(questionPrevious?.action==='explain_cash_price'&&/\b(?:renovated|new roof|repaired|repairs?|square feet|bedrooms?|bathrooms?)\b/i.test(source.body))return ask('repair_budget','What is your estimate of the total remaining repair budget?');
 if(/^(?:who pays (?:the )?closing costs|(?:are there|what about|what are|any) (?:the |any )?fees)[?! .]*$/i.test(source.body))return ask('explain_costs',sellerAnswerCopy.explain_costs.current);
 if(/^(?:how (?:does|will) (?:this|it) work|what happens next)[?! .]*$/i.test(source.body))return ask('explain_process',sellerAnswerCopy.explain_process.current);
 if(isDeliveredCallInvitation(questionPrevious)&&unqualifiedYes(source.body))return ask('invite_call_time','What day and time work for a call?');
 // Answer the seller's actual question before resuming the missing fact. A
 // listing reference does not establish agent representation or accept its terms.
 if(c.conversionEnabled&&(qualification.ready||!qualification.stop)){
  if(intent==='listed_terms')return ask('clarify_listing_terms','Is the property listed with an agent, or are you selling it yourself?');
  if(intent==='identity'||intent==='identity_price'||intent==='buying'){
   const principal=c.principal.trim();
   if(!principal||principal.length>80||/[\r\n]/.test(principal))return review('buyer_identity_required','Verify the saved buyer identity before answering.');
   const intro=intent==='buying'?`I assist ${principal} with potential cash purchases.`:`I'm the AI assistant for ${principal}.`;
   if(!qualification.ready){
    const body=intro+(intent==='identity_price'?' Price depends on the property details.':'')+' '+qualification.nextQuestion;
    if(body.length>160)return review('buyer_identity_copy_required','The full saved buyer identity and answer must fit the reviewed text rate.');
    return ask('answer_buyer_question',body);
   }
   // Keep the actual next action so the answer still binds to the price/name/
   // terms question. Identity alone never authorizes agreement delivery.
   replyIntro=intro;
  }
 }
 if(!qualification.ready){
  if(c.callInvitationAllowed===true&&intent!=='price'&&!sellerRequestsPrice(source.body)&&!source.body.includes('?')&&!qualification.missing.includes('ownership')&&!qualification.missing.includes('interest')
   &&!priorCallPreference(c.messages)&&!state.quotedPriceCents&&!state.acceptedPriceCents)
   return ask('invite_call',sellerCallInvitation);
  const priceQuestion=sellerRequestsPrice(source.body)||intent==='price';
  return ask('qualify_'+qualification.missing[0],(priceQuestion?'An offer depends on the property details. ':'')+qualification.nextQuestion);
 }
 const offer=calculateAutomaticCallOffer({party:'seller',address:c.address,snapshot:c.snapshot},state,now);
 if(!offer.quoteAllowed){
  if(offer.reason==='repair_estimate_required')return ask('repair_budget','What is your estimate of the total repair budget?');
  return review(offer.reason,offer.instruction);
 }
 const contractAllowed='contractAllowed' in offer&&offer.contractAllowed===true;
 const revision=sha(JSON.stringify(canonical({snapshot:c.snapshot,price:offer.priceCents,repairs:state.repairEstimateCents??null,payoff:state.payoffReport??null,contractAllowed})));
 const quotedBefore=questionPrevious?.action==='cash_offer'&&questionPrevious.priceCents===offer.priceCents&&questionPrevious.quoteRevision===revision;
 const exactPriceAnswer=sellerPrice===offer.priceCents&&/works for me/i.test(source.body);
 const freshlyAccepted=quotedBefore&&(callOfferEvidence(sourceTranscript,{action:'accept_offer',priceCents:offer.priceCents})||exactPriceAnswer);
 if(freshlyAccepted){
  state.acceptedPriceCents=offer.priceCents;state.acceptanceConditional=!contractAllowed;
  delete state.receiptPriceAuthority;
 }
 if(state.quoteRevision!==revision&&state.quoteRevision&&!freshlyAccepted){
  // A changed source revision requires a fresh confirmation but must never
  // replace the original agreed amount with a higher recomputed ceiling on
  // the next reply. This marker preserves evidence, not agreement authority.
  if(state.acceptedPriceCents)state.receiptPriceAuthority??={sourceId:c.sourceId,priceCents:state.acceptedPriceCents,quoteRevision:state.quoteRevision};
  state.acceptanceConditional=false;
 }
 state.quotedPriceCents=offer.priceCents;state.quoteRevision=revision;state.contractBlocked=!contractAllowed;state.snapshotHash=sha(JSON.stringify(canonical(c.snapshot)));
 if(!contractAllowed){
  const next='nextQuestion' in offer&&typeof offer.nextQuestion==='string'?offer.nextQuestion:'What is the current mortgage payoff balance?';
  if(questionPrevious?.action==='payoff'&&/\b(?:don't know|do not know|not sure)\b/i.test(source.body))return review('payoff_evidence_required','Obtain the actual outstanding debt information before sending the agreement. The cash proposal remains conditional.');
  return ask('payoff',`${!c.messages.some(m=>m.action==='payoff')?`As-is cash proposal: ${priceText(offer.priceCents)}, subject to payoff and liens. `:''}${next}`);
 }
 if(!state.acceptedPriceCents||state.acceptanceConditional||state.receiptPriceAuthority){
  const counter=sellerPrice!==null&&sellerPrice>offer.priceCents?`You asked ${priceText(sellerPrice)}. `:'';
  return ask('cash_offer',`${counter}Our as-is cash proposal is ${priceText(offer.priceCents)}, based on property value, repairs and holding costs. Does that work?`);
 }
 const identity=sellerAgreementIdentityEvidence({transcript:conversationHistory.flatMap(h=>{
  const rows=(h as {transcript?:unknown[]})?.transcript;return Array.isArray(rows)?rows:[];
 })},closing.legalName??'');
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
 if(replyIntro||!sellerAgreementEvidence(c.historyComplete?{transcript:conversationHistory.flatMap(h=>{const rows=(h as {transcript?:unknown[]})?.transcript;return Array.isArray(rows)?rows:[];})}:transcript,terms,now))return ask('confirm_terms',`${priceText(terms.priceCents!)} cash; closing ${terms.closingDate}; ${terms.inspectionDays}-day inspection. Do these terms work, and may I text the agreement now?`);
 return {kind:'agreement',action:'prepare_agreement',state,terms,confirmation};
}
