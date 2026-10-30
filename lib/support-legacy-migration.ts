type Turn={role:string;content:string};

export const supportLegacyOfferUrl='https://www.geticashx.com/legacy-offer';
export const supportLegacyProofEmail='support@geticashx.com';
export const supportLegacyStatus='iCash X 1.0 is no longer active and is being shut down. The current platform is iCash X 2.0.';
const proofStep=`Email your original iCash X 1.0 purchase receipt to ${supportLegacyProofEmail} with the subject “iCash X 1.0 purchase proof.” Once Support verifies the purchase, we can send you the link for two calendar months of 2.0 software access free.`;

/** Only the authenticated operator review action may send this offer. Chat claims
 * and a matching visitor email never establish a verified original purchase. */
export const supportVerifiedLegacyOfferReply=`We’ve verified your original iCash X 1.0 purchase. Here’s your link for two calendar months of iCash X 2.0 software access free: ${supportLegacyOfferUrl}\n\nA payment method is required. It’s $0 for those two calendar months, then $50/month unless you cancel. Work credits are separate. Review and accept the terms on that page; this message does not activate access.`;

export function supportLegacyQuestion(text:string){
 return /\b1\.0\b|\b(?:i[ -]?cash\s*x?|icashx)\s*(?:v(?:ersion)?\s*)?1\b|\b(?:original|old|previous|former|legacy|first)\s+(?:(?:version of|version|my|the)\s+)?(?:i[ -]?cash\s*x?|icashx|platform|software|app|version)\b|\b(?:i[ -]?cash\s*x?|icashx)\s+(?:original|old|legacy)\b|\b(?:move[ds]?|switch(?:ed)?)\b.{0,35}\b(?:another|different|new)\s+(?:platform|app)\b/i.test(text);
}

const continuation=(text:string)=>/^(?:yes|no|ok(?:ay)?|thanks|thank you)[.!?\s]*$/i.test(text.trim())||/^(?:where is that(?: at)?|what (?:do you mean|happened|do i do now|if .{0,25}(?:receipt|proof))|how (?:do i|can i) (?:prove|verify|send|switch|move|upgrade)|(?:what|do i need .{0,20}) (?:proof|receipt)|where (?:do i|can i) (?:send|email)|can (?:i|you) .{0,25}(?:link|offer)|send .{0,25}(?:link|offer)|i (?:already )?(?:bought|purchased|paid|had|used|sent|emailed)|here.{0,12}(?:proof|receipt)|(?:my |the )?(?:receipt|proof|order|purchase)|(?:i )?(?:don[’']?t|do not|can[’']?t|cannot) .{0,20}(?:receipt|proof)|any update|still waiting|is it free|how much|what about (?:my )?(?:data|leads|credits)|does .{0,20}transfer|will .{0,20}transfer)/i.test(text.trim());
const submitted=(text:string)=>/\b(?:sent|emailed|submitted)\b.{0,35}\b(?:receipt|proof)|\b(?:receipt|proof)\b.{0,20}\b(?:sent|emailed)\b|^(?:i (?:have |already |just )?)?(?:sent|emailed|submitted) it\b/i.test(text)&&!/\b(?:not|never|haven[’']t|didn[’']t)\b/i.test(text);

/** Keep migration follow-ups on topic, but never let old history override a new
 * billing, sign-in or product question. Eligibility always needs human review. */
export function supportLegacyMigrationReply(messages:Turn[]):{reply:string;status:'open'|'waiting_on_customer'}|null{
 let active=false,proofSent=false;
 for(const turn of messages){
  if(turn.role!=='user')continue;
  const text=turn.content;
  if(/\b(?:2\.0|new (?:platform|app|workspace))\b.{0,60}\b(?:code|log[ -]?in|sign[ -]?in|error|stuck|not working)\b/i.test(text)){active=false;proofSent=false;continue;}
  if(/\b(?:cancel|refund|money back|charged twice|duplicate charge|new card|bot|calls?|texts?|course|photos?)\b/i.test(text)&&!supportLegacyQuestion(text)){active=false;proofSent=false;continue;}
  active=supportLegacyQuestion(text)||(active&&(continuation(text)||submitted(text)));
  proofSent=active&&(proofSent||submitted(text));
 }
 if(!active)return null;
 const question=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 const verified=messages.some(m=>m.role==='operator'&&m.content===supportVerifiedLegacyOfferReply);
 const pendingProof='You’ve said you sent your receipt. I can’t confirm that it has been verified yet, so I can’t send the offer link. You don’t need to send the same receipt again; this conversation remains open.';
 if(/\b(?:data|leads|credits|transfer|carry over)\b/i.test(question))return {reply:'Your 1.0 account data does not transfer to 2.0. The two-month offer covers software access; work credits are separate.'+(verified?' Your verified offer link is in the earlier Support reply.':proofSent?' '+pendingProof:' '+proofStep),status:proofSent&&!verified?'open':'waiting_on_customer'};
 if(verified)return {reply:/^(?:thanks|thank you|ok(?:ay)?)[.!\s]*$/i.test(question.trim())?'You’re welcome. Your offer link is in the verified purchase reply above. Complete that page to activate access.':supportVerifiedLegacyOfferReply,status:'waiting_on_customer'};
 if(/\b(?:free|cost|price|how much|card|charge|billing|months?)\b/i.test(question)&&!supportLegacyQuestion(question))return {reply:'For verified 1.0 customers, the offer is two calendar months of 2.0 software access for $0, then $50/month unless cancelled. A payment method is required and work credits are separate. '+(proofSent?pendingProof:proofStep),status:proofSent?'open':'waiting_on_customer'};
 if(proofSent)return {reply:pendingProof,status:'open'};
 if(/\b(?:attached|here(?:’s|'s| is))\b.{0,35}\b(?:receipt|proof)/i.test(question))return {reply:'This chat doesn’t accept receipt attachments. '+proofStep,status:'waiting_on_customer'};
 if(/\b(?:don[’']?t|do not|can[’']?t|cannot|lost|no)\b.{0,30}\b(?:receipt|proof)|\b(?:receipt|proof)\b.{0,20}\b(?:lost|missing)\b/i.test(question))return {reply:`If you can’t find the receipt, email ${supportLegacyProofEmail} with the original purchase email and approximate purchase date and amount. Those details can help locate the purchase, but eligibility still needs verification before we send the offer.`,status:'waiting_on_customer'};
 return {reply:supportLegacyStatus+' '+proofStep,status:'waiting_on_customer'};
}
