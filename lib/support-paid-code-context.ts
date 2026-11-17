import {supportPurchaseEmailCorrection} from './support-purchase-help.ts';
import {supportCodeDelivery} from './support-code-delivery.ts';
import {supportReportedPurchase} from './support-access-reply.ts';
type Turn={role:string;content:string};
/** Preserve a missing-code episode through its payment grievance, not through
 * unrelated questions, successful delivery or a later operator finding. */
export function supportPaidCodeContext(context:{messages:Turn[]}){
 const turns=context.messages;
 const index=turns.findLastIndex(t=>t.role==='user');
 if(index<1)return null;
 const q=turns[index].content;
 if(supportPurchaseEmailCorrection(q))return null;
 const previous=turns[index-1];
 if(previous?.role==='assistant'&&/payment date and amount on your receipt/i.test(previous.content)&&/\[number removed\]/.test(q)&&/^[\d\s$./-]*\[number removed\][\d\s$./-]*$/.test(q))return {reply:'Part of your payment detail was automatically hidden, so I cannot reliably read the date and amount. Please give the payment date in words and the amount separately, without card numbers or codes. The access issue remains unresolved; do not pay again or repeat failed sign-in attempts.',status:'open' as const,managementReview:true,ai:false};
 const access={test:(text:string)=>/\b(?:code|sign[ -]?in|log[ -]?in)\b/i.test(text)&&!/\b(?:zip|postal|promo|coupon|source|referral|error|area) code\b/i.test(text)};
 const grievance=/\b(?:keep|take|took|get|got)\b.{0,35}\b(?:my money|free|\$)|\b(?:keep|take|took|get|got)\b.{0,35}\$/i;
 if(/\b(?:refund|cancel|credits?|seller|buyer|contract|voice|course|vip|if|hypothetical)\b/i.test(q)||!access.test(q)&&!grievance.test(q))return null;
 let episode:Turn[]=[];
 for(const t of turns.slice(0,index)){
  if(t.role==='operator'){episode=[];continue;}
  if(t.role!=='user'){if(episode.length)episode.push(t);continue;}
  if(/\b(?:signed in|logged in|got in|working now|it worked)\b/i.test(t.content)){episode=[];continue;}
  if(access.test(t.content)){episode.push(t);continue;}
  const previous=episode.at(-1);
  if(episode.length&&previous?.role==='assistant'&&/payment date and amount on your receipt/i.test(previous.content)&&/^[\d\s$./-]*(?:\[number removed\])?[\d\s$./-]*$/.test(t.content)){episode.push(t);continue;}
  if(episode.length&&(/\b(?:refund|paid|paying|payment|money)\b/i.test(t.content)||grievance.test(t.content)||/^(?:still|same|nothing|yes|no|sign in)\b/i.test(t.content))){episode.push(t);continue;}
  episode=[];
 }
 if(!supportReportedPurchase([...episode,turns[index]])||supportCodeDelivery(episode)!=='missing')return null;
 if(supportCodeDelivery([...episode,turns[index]])==='received')return null;
 return {reply:'Code delivery remains unconfirmed, and your reported payment and access problem still need review. The earlier instructions did not restore access; you do not need to enter a code you never received, pay again or repeat failed requests. Management can review the saved details in this conversation. This reply does not confirm a refund or restored access.',status:'open' as const,managementReview:true,ai:false};
}
