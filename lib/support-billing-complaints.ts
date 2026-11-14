import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportDuplicateCharge,supportRenewalCancellationRequested} from './support-policy.ts';

/** Routing only. Neither customer wording nor a balance check verifies a
 * cancellation, a disputed charge, or authority to change funds/access. */
export function supportBillingComplaintReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(m=>m.role==='user')?.content??'';
 const operator=context.messages.findLastIndex(m=>m.role==='operator');
 const users=context.messages.slice(operator+1).filter(m=>m.role==='user');
 const blocked=(s:string)=>/\b(?:cannot|can[’']?t|unable to|won[’']?t let me) (?:sign[ -]?in|log[ -]?in)\b|\b(?:sign[ -]?in|log[ -]?in) (?:is )?blocked\b/i.test(s);
 const unsubscribe=(s:string)=>/\bunsubscribe\b/i.test(s)&&supportRenewalCancellationRequested(s);
 const followup=(s:string)=>/^(?:(?:oh+[, ]+)?ok(?:ay)?[, ]+(?:i(?:[’']m| am) sorry[, ]+)?(?:so[, ]+)?)?(?:so[, ]+)?(?:what (?:do|can|should) i do(?: now)?|do (?:you|i) need (?:any )?(?:info(?:rmation)?|details)(?: from me)?|i don[’']?t have to give you (?:info(?:rmation)?|details)(?: or anything)?)[?!.\s]*$/i.test(s.replace(/[?!,]/g,' ').replace(/\s+/g,' ').trim());
 let accessCancellation=false;
 for(const turn of users){
  if(unsubscribe(turn.content)&&blocked(turn.content))accessCancellation=true;
  else if(!(accessCancellation&&(followup(turn.content)||unsubscribe(turn.content)||/^i would like management to review this conversation[.!\s]*$/i.test(turn.content))))accessCancellation=false;
 }
 if(accessCancellation&&!supportDuplicateCharge(q)&&!/\b(?:refund|money back)\b/i.test(q)){
  const asked=context.messages.slice(operator+1).some(m=>m.role==='assistant'&&/date and amount/i.test(m.content));
  return {reply:'You’re asking to stop future renewals, and sign-in is blocked. This chat has not cancelled the subscription or verified the charge. '+(asked?'Keep the statement date and amount already requested in this review; you do not need to repeat supplied details.':'What payment date and amount appear on your bank or card statement?')+' Those details help locate the purchase for cancellation and access review. Leave out card numbers and sign-in codes; don’t pay again or add another card.',status:'open',managementReview:true,ai:false};
 }
 const pausedCredit=/\b(?:bot|automation)\b/i.test(q)&&/\bpaus(?:ed|ing|e)\b/i.test(q)&&/\b(?:credits?|balance)\b/i.test(q)&&/\b(?:used|using|spent|spending|lost|losing|decreas(?:e|ed|ing)|deduct(?:ed|ing)|charg(?:e|ed|es)|went down)\b/i.test(q);
 if(!pausedCredit||supportDuplicateCharge(q)||supportRenewalCancellationRequested(q)||/\b(?:refund|subscription|card|seller|buyer|credit score|not asking|never decreased|not decreasing|not used|weren[’']?t used|not paused)\b/i.test(q))return null;
 const work=context.kind==='account'?context.evidence?.find(e=>e.key==='work'&&e.source==='icash_accounts'&&e.status!=='unknown'):undefined;
 const state=work?.code==='paused'?'The current account check confirms your bot is paused. ':work?.code==='not_paused'?'The current account check says your bot is not paused now; that does not establish its earlier state. ':'I haven’t verified the current pause state from these checks. ';
 const asked=context.messages.slice(operator+1).some(m=>m.role==='assistant'&&/when did you pause/i.test(m.content));
 return {reply:state+'Pause stops new automated work; already-started work may finish and its costs may be recorded later. That is a possibility, not a verified explanation for the credit decrease you reported. The pause time and original usage entries need to be compared; available credits and commitments alone cannot establish the cause. '+(asked?'Any pause time and usage details you already supplied remain part of this review.':'When did you pause the bot, including your time zone?')+' No credits have been returned or new work started by this chat.',status:'open',managementReview:true,ai:false};
}
