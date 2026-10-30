import {supportContinuation} from './support-reply-style.ts';
import type {SupportContext,SupportReply,SupportTurn} from './support-conversation.ts';
const offer=(text:string)=>/\b(?:two|2)[ -](?:calendar[ -])?months?\b.{0,30}\bfree\b|\bfree\b.{0,25}\b(?:two|2)[ -](?:calendar[ -])?months?\b|\b(?:returning|legacy|welcome.back)\b.{0,25}\boffer\b/i.test(text);
const problem=(text:string)=>/check.?out|accept(?:ing)?|not going through|did not go through|doesn[’']?t work|not work|failed|cannot|can[’']?t|error|stuck|support/i.test(text);

/** Follow-ups retain the failed offer, including sign-in confusion caused by an
 * earlier reply. New substantive topics and explicit code-delivery faults end it. */
export function currentOfferProblem(messages:SupportTurn[]){
 let start=-1;
 for(let i=0;i<messages.length;i++){
  const m=messages[i];if(m.role!=='user')continue;
  if(offer(m.content)&&problem(m.content)){if(start<0)start=i;continue;}
  if(start<0)continue;
  if(/\b(?:refund|cancel|charged twice|course|leads?|bot|photos?|contract)\b/i.test(m.content)||/\bcode\b.{0,35}(?:arriv|received|missing|invalid|expired)|(?:no|missing)\s+(?:email\s+)?code/i.test(m.content)){start=-1;continue;}
  if(!supportContinuation(m.content)&&!offer(m.content)&&! /^(?:when i try|the error|it says|it basically says|i(?:[’']m| am) (?:using|on)|safari|chrome|iphone|android|email|i can(?:not|[’']t) (?:find|open|resume)|you (?:have|already)|please (?:help|look)|how do i (?:resume|verify))/i.test(m.content.trim()))start=-1;
 }
 return start<0?[]:messages.slice(start);
}

export function supportCheckoutReply(context:SupportContext):SupportReply|null{
 const active=currentOfferProblem(context.messages);if(!active.length)return null;
 const users=active.filter(m=>m.role==='user'),last=users.at(-1)?.content??'',history=users.map(m=>m.content).join('\n');
 const identity=context.kind==='account'?'This chat is connected to your signed-in account. ':context.contactKnown?'I have the email attached to this chat. ':'';
 const priorResume=active.some(m=>m.role!=='user'&&/Resume a checkout from another device/.test(m.content));
 let reply:string;
 if(priorResume&&/still|same|already|doesn[’']?t|didn[’']?t|cannot|can[’']?t|failed|not work|error|contact support|it says/i.test(last))reply=identity+'The offer still isn’t confirmed. I’m keeping this issue open with the failed steps you reported; you don’t need to repeat them or start a separate $50 checkout.';
 else if(/(?:says|message|error).{0,100}(?:support|doesn[’']?t work|does not work|could not open|unavailable)|contact support|reach out to you|resume|another device/i.test(history))reply=identity+'On the original offer page, choose “Resume a checkout from another device” and verify the original purchase email. Then select “Continue to secure checkout.” That verification does not purchase a subscription. Keep using the two-month offer; don’t start a separate $50 checkout.';
 else reply=identity+'I’m keeping the two-month offer checkout as the issue here. What exact message appears when you select “Continue to secure checkout”?';
 return {reply,status:users.length>1||priorResume?'open':'waiting_on_customer',ai:false};
}

export function supportIdentityReply(context:SupportContext):string|null{
 const latest=context.messages.filter(m=>m.role==='user').at(-1)?.content??'';
 if(!/\b(?:you (?:already )?(?:have|know|see)|what (?:account|email)|which (?:account|email)|why.{0,25}ask.{0,25}(?:email|account))\b/i.test(latest))return null;
 if(context.kind==='account')return 'This chat is connected to your signed-in account, so you don’t need to send your email again. I’ll use the account details and conversation already attached here.';
 if(context.contactKnown)return 'The email you entered is already attached to this conversation, so you don’t need to send it again. Email verification is still required before opening private account details.';
 return null;
}
