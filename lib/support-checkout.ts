import {supportVerifiedLegacyOfferReply} from './support-legacy-migration.ts';
import {supportContinuation} from './support-reply-style.ts';
import type {SupportContext,SupportReply,SupportTurn} from './support-conversation.ts';
const offer=(text:string)=>/\b(?:two|2)[ -](?:calendar[ -])?months?\b.{0,30}\bfree\b|\bfree\b.{0,25}\b(?:two|2)[ -](?:calendar[ -])?months?\b|\b(?:returning|legacy|welcome.back)\b.{0,25}\boffer\b/i.test(text);
const problem=(text:string)=>/check.?out|accept(?:ing)?|not going through|did not go through|doesn[’']?t work|not work|failed|cannot|can[’']?t|error|stuck|support/i.test(text);

/** A code requested during an offer may belong to checkout recovery, not a
 * completed purchase. Keep that distinction until the stage is established. */
export function supportOfferCodeReply(messages:SupportTurn[]):SupportReply|null{
 const replacement=supportOfferReplacementReply(messages);if(replacement)return replacement;
 let start=-1;
 const code=(text:string)=>/\bcode\b/i.test(text)&&!/\b(?:promo|coupon|discount|zip|area|source) code\b/i.test(text);
 const completed=(text:string)=>{
  const claim=text.match(/\b(?:checkout|purchase|offer)\b[^.!?]{0,35}\b(?:completed|successful|confirmed)\b/i)?.[0];
  return !!claim&&!/\b(?:not|never|isn[’']t|wasn[’']t)\b/i.test(claim);
 };
 for(let i=0;i<messages.length;i++){
  const m=messages[i];
  if(m.role==='operator'){start=-1;continue;}
  if(m.role!=='user')continue;
  const recovered=/\b(?:that worked|it worked|signed in|got in)\b/i.test(m.content)&&!/\b(?:not|never|still|but|haven[’']t|didn[’']t)\b/i.test(m.content);
  if(completed(m.content)||/\b(?:refund|cancel|charged twice|duplicate charge|unrecognized charge|course|leads?|seller|buyer|bot|contract)\b/i.test(m.content)||recovered){start=-1;continue;}
  if(code(m.content)&&(offer(m.content)||/\blegacy checkout\b/i.test(m.content))){if(start<0)start=i;continue;}
  if(start>=0&&/\b(?:management review|manager|support representative|human support)\b/i.test(m.content))continue;
  if(start>=0&&!code(m.content)&&!supportContinuation(m.content)&&!/^(?:no|nothing|email|text|sms|i checked|it says|it keeps|secure checkout|resume a checkout|(?:the |iCash X )?sign[ -]?in page|the (?:offer|checkout|page|button))\b/i.test(m.content.trim()))start=-1;
 }
 if(start<0)return null;
 const active=messages.slice(start);
 const asked=active.some(m=>m.role==='assistant'&&/which page.*code/i.test(m.content));
 if(asked)return {reply:'The offer’s code step is still unresolved. Your earlier details and failed steps are saved here. This chat hasn’t sent a code or changed software access; don’t keep requesting codes or start another checkout to troubleshoot this.',status:'open',ai:false};
 return {reply:'A code request during an offer does not by itself confirm that checkout finished. Which page is asking for the code: secure checkout, “Resume a checkout from another device,” or the iCash X sign-in page? Please leave out the code and payment details; don’t start another checkout to troubleshoot this.',status:'waiting_on_customer',ai:false};
}

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

function supportOfferReplacementReply(messages:SupportTurn[]):SupportReply|null{
 const q=messages.findLast(m=>m.role==='user')?.content??'';
 if(/\b(?:refund|money back|cancel|charged twice|duplicate charge|unrecognized charge)\b/i.test(q))return null;
 // A replacement request identifies the page; don't ask that question again or
 // send an unverified entitlement link. Direct current intent bounds inheritance.
 if(/\blegacy[ -]offer\b/i.test(q)&&/\b(?:new|replacement|another) link\b/i.test(q)&&!/\b(?:don[’']?t|do not|no longer) (?:want|need)|\b(?:course|seller|buyer|contract)\b/i.test(q)){
  const verified=messages.findLast(m=>m.role==='operator')?.content===supportVerifiedLegacyOfferReply;
  const next=verified?'Your earlier verified-purchase reply contains the offer link. I haven’t issued a replacement link; the existing checkout and code-delivery state still need review.':'I haven’t issued a new link or confirmed offer eligibility. The original offer’s verification and checkout state need review before a replacement can be sent.';
  return {reply:'You’ve identified the legacy-offer page and asked for a replacement link. '+next+' A new link alone is not a confirmed fix; any failed steps already reported remain saved here. Don’t start another paid checkout to troubleshoot this.',status:'open',managementReview:true,ai:false};
 }
 return null;
}

export function supportCheckoutReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(m=>m.role==='user')?.content??'';
 if(/\b(?:refund|money back|cancel|charged twice|duplicate charge|unrecognized charge)\b/i.test(q))return null;
 const replacement=supportOfferReplacementReply(context.messages);if(replacement)return replacement;
 const offerCode=supportOfferCodeReply(context.messages);if(offerCode)return offerCode;
 const active=currentOfferProblem(context.messages);if(!active.length)return null;
 const users=active.filter(m=>m.role==='user'),last=users.at(-1)?.content??'',history=users.map(m=>m.content).join('\n');
 const identity=context.kind==='account'?'This chat is connected to your signed-in account. ':context.contactKnown?'I have the email attached to this chat. ':'';
 const priorResume=active.some(m=>m.role!=='user'&&/Resume a checkout from another device/.test(m.content));
 let reply:string;
 if(priorResume&&/still|same|already|doesn[’']?t|didn[’']?t|cannot|can[’']?t|failed|not work|error|contact support|it says/i.test(last))reply=identity+'The offer still isn’t confirmed. I’m keeping this issue open with the failed steps you reported; you don’t need to repeat them or start a separate $50 checkout.';
 else if(/(?:says|message|error).{0,100}(?:support|doesn[’']?t work|does not work|could not open|unavailable)|contact support|reach out to you|resume|another device/i.test(history))reply=identity+'Your offer checkout has not been confirmed. On the original offer page, choose “Resume a checkout from another device” and verify the original purchase email. Then select “Continue to secure checkout.” That verification does not purchase a subscription. Keep using the two-month offer; don’t start a separate $50 checkout.';
 else reply=identity+'I’m keeping the two-month offer checkout as the issue here. What exact message appears on the checkout page when you select “Continue to secure checkout”?';
 return {reply,status:users.length>1||priorResume?'open':'waiting_on_customer',ai:false};
}

export function supportIdentityReply(context:SupportContext):string|null{
 const latest=context.messages.filter(m=>m.role==='user').at(-1)?.content??'';
 if(!/\b(?:you (?:already )?(?:have|know|see)\s+(?:(?:my|the|this|that)\s+)?(?:email|account|identity)|what (?:account|email)|which (?:account|email)|why.{0,25}ask.{0,25}(?:email|account))\b/i.test(latest))return null;
 if(context.kind==='account')return 'This chat is connected to your signed-in account, so you don’t need to send your email again. I’ll use the account details and conversation already attached here.';
 if(context.contactKnown)return 'The email you entered is already attached to this conversation, so you don’t need to send it again. Email verification is still required before opening private account details.';
 return null;
}
