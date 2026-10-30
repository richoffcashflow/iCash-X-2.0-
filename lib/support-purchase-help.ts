import {supportLegacyProofEmail} from './support-legacy-migration.ts';
type Turn={role:string;content:string};

/** Purchase and checkout problems are not proof that a sign-in code arrived. */
export function supportPurchaseHelp(messages:Turn[]){
 const users=messages.filter(m=>m.role==='user'),q=users.at(-1)?.content??'';
 if(/\b(?:refund|cancel|charged twice|duplicate charge|new card)\b/i.test(q))return null;
 const checkout=/\b(?:checkout|check out|two[ -]month|2[ -]month|free (?:trial|offer))\b/i;
 const failed=/\b(?:failed|not go through|didn[’']?t go through|did not go through|doesn[’']?t work|does not work|not work|doesn[’']?t let|error|declined|not completed|won[’']?t)\b/i;
 const previous=users.slice(0,-1).findLast(m=>checkout.test(m.content)&&failed.test(m.content));
 const hasReceipt=users.some(m=>/\b(?:checkout|offer)\b.{0,35}\b(?:completed|successful|confirmed)\b/i.test(m.content)&&!/\b(?:not|never|isn[’']t)\b/i.test(m.content));
 if(checkout.test(q)&&failed.test(q)||previous&&!hasReceipt&&/\b(?:sign[ -]?in|log[ -]?in|email on file|same error|still not)\b/i.test(q)){
  const asked=messages.some(m=>m.role!=='user'&&/exact message.*checkout/i.test(m.content));
  return {reply:asked?'The offer checkout has not been confirmed as complete. I can’t establish an active subscription or a code-delivery problem from that error. Your earlier details are saved; don’t submit another payment to troubleshoot this.':'The offer checkout needs to complete before it can grant software access. What exact message appears on the checkout page when it fails? Please leave out payment details; don’t submit another payment to troubleshoot this.',status:asked?'open' as const:'waiting_on_customer' as const};
 }
 const wrongEmail=/\b(?:wrong|incorrect|typo|misspelled|correct|change|update)\b.{0,35}\b(?:checkout |purchase |sign[ -]?in )?email\b|\bemail\b.{0,35}\b(?:wrong|incorrect|typo|misspelled|corrected)\b/i;
 if(wrongEmail.test(q)&&!/\b(?:seller|buyer|bot|contact|settings)\b/i.test(q)){
  const requested=messages.some(m=>m.role!=='user'&&/\b(?:receipt|purchase)\b.{0,100}\b(?:email|correction|correct|verify|match)\b/i.test(m.content));
  return {reply:requested?'The purchase needs to be matched and ownership verified before its checkout email can be corrected. Your earlier proof details are already in this conversation. I haven’t confirmed an email change or restored access; repeating code requests won’t correct a wrong email.':`A wrong checkout email needs a purchase-ownership check before it can be corrected. Email your merchant receipt to ${supportLegacyProofEmail} with the purchase date, amount, order reference if available, and the email you intended to use. This chat has not changed the email; don’t pay again or share sign-in codes.`,status:requested?'open' as const:'waiting_on_customer' as const};
 }
 return null;
}
