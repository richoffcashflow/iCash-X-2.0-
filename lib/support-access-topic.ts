import {supportContinuation} from './support-reply-style.ts';
type Turn={role:string;content:string};
const signIn=(text:string)=>/\b(?:sign[ -]?in|log[ -]?in|login|verification code|otp|getting in|get in)\b|\b(?:cannot|can[’']?t|unable to) access\b/i.test(text)||(/\bcode\b/i.test(text)&&!/\b(?:promo|coupon|discount|source|referral|zip|error|status)\s+code\b/i.test(text));
const detail=(text:string)=>supportContinuation(text)||/^(?:email|text|sms|phone|iphone|android|ipad|safari|chrome|firefox|edge|desktop|laptop|browser|nothing|no (?:error|message)|both|(?:got|received) it|invalid|expired|yes[, ]+(?:it|that) matches|i(?:[’']ve| have) (?:already )?(?:done|tried|used|entered)|it (?:didn[’']t|hasn[’']t|never) (?:send|sent)|are you going to send it)\b/i.test(text.trim())||/\b(?:receipt email|email.{0,20}receipt|receipt.{0,20}email|haven[’']?t received the email|no email|no text)\b/i.test(text);

/** A guest help page is not evidence of a sign-in fault. End the old sign-in
 * episode when the customer asks a different substantive question. */
export function currentAccessConversation(messages:Turn[]){
 let start=-1;
 for(let index=0;index<messages.length;index++){
  const turn=messages[index];if(turn.role!=='user')continue;
  if(signIn(turn.content)){if(start<0)start=index;}
  else if(start>=0&&!detail(turn.content))start=-1;
 }
 return start<0?[]:messages.slice(start);
}
