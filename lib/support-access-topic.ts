import {supportContinuation} from './support-reply-style.ts';
type Turn={role:string;content:string};
const signIn=(text:string)=>/\b(?:sign[ -]?in|log[ -]?in|login|verification code|otp|getting in|get in)\b|\b(?:cannot|can[’']?t|unable to) access\b/i.test(text)||(/\bcode\b/i.test(text)&&!/\b(?:promo|coupon|discount|source|referral|zip|area|country|postal|error|status)\s+code\b/i.test(text));
const detail=(text:string)=>supportContinuation(text)||/^(?:email|text|sms|phone|iphone|android|ipad|safari|chrome|firefox|edge|desktop|laptop|browser|nothing|no (?:error|message)|both|(?:got|received) it|invalid|expired|yes[, ]+(?:it|that) matches|i(?:[’']ve| have) (?:already )?(?:done|tried|used|entered)|it (?:didn[’']t|hasn[’']t|never) (?:send|sent)|are you going to send it)\b/i.test(text.trim())||/\b(?:receipt email|email.{0,20}receipt|receipt.{0,20}email|haven[’']?t received the email|no email|no text)\b/i.test(text)
 || /^i(?:[’']m| am) (?:using|on)\b.{0,35}\b(?:safari|chrome|firefox|edge|iphone|android|ipad|desktop|laptop)\b/i.test(text.trim());

/** A guest help page is not evidence of a sign-in fault. End the old sign-in
 * episode when the customer asks a different substantive question. */
export function currentAccessConversation(messages:Turn[]){
 let start=-1;
 for(let index=0;index<messages.length;index++){
  const turn=messages[index];if(turn.role!=='user')continue;
  if(/^(?:i(?:[’']?m| am) (?:already )?signed in|it worked|i got in)[.!\s]*$/i.test(turn.content.trim())){start=-1;continue;}
  const previousTurn=messages[index-1];
  const previous=messages.slice(0,index).findLast(m=>m.role==='assistant'||m.role==='operator')?.content??'';
  // Confirmation answers the preceding receipt-email question only. It is
  // customer-supplied context, never proof of payment or restored access.
  const receiptEmailConfirmation=previousTurn?.role==='assistant'&&/\breceipt\b/i.test(previousTurn.content)&&/\bemail\b/i.test(previousTurn.content)&&/\bmatch\b/i.test(previousTurn.content)&&previousTurn.content.includes('?')&&/^(?:yes[,\s]+)?(?:(?:the |my )?email (?:is (?:the )?same|matches)|(?:it|that) match(?:es)?)[.!\s]*$/i.test(turn.content.trim());
  const paymentDetail=(/payment date and amount|date and amount on (?:your|the) receipt/i.test(previous)||/^(?:(?:the )?payment date (?:is|was) (?:for )?|(?:the )?date is (?:for )?)?(?:today|yesterday|\d+ hours? ago)\b/i.test(turn.content.trim()))&&/\$\s*\d|\d\s*\$|\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b|\b(?:dollars|paid)\b/i.test(turn.content);
  if(signIn(turn.content)){if(start<0)start=index;}
  else if(start>=0&&!detail(turn.content)&&!receiptEmailConfirmation&&!paymentDetail&&!/\b(?:no|missing|didn[’']?t (?:get|receive)|did not (?:get|receive)|never (?:got|received))\b.{0,35}\b(?:receipt|email)\b|^no[, ]+(?:it|that) (?:didn[’']?t|did not)[.!?\s]*$/i.test(turn.content.trim()))start=-1;
 }
 return start<0?[]:messages.slice(start);
}
