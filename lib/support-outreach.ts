import {z} from 'zod';
import type {SupportEvidence} from './support-policy.ts';
import {currentSupportIssue,supportContinuation} from './support-reply-style.ts';

const count=z.number().int().nonnegative().safe();
export const supportOutreachSchema=z.object({
 screened:count,outboundProperties:count,inboundProperties:count,contactProperties:count,
 textsSent:count,textsDelivered:count,textReplies:count,callsStarted:count,callsBudgetHeld:count,
 progress:z.object({status:z.string(),remainingCents:count,limitCents:count.optional(),spentCents:count,pendingCents:count.optional(),spendingMode:z.string().optional(),fundedBaselineCents:count.optional()}).passthrough().nullable(),
});
export type SupportOutreachSnapshot=z.infer<typeof supportOutreachSchema>;
export function supportOutreachEvidence(value:unknown):Omit<SupportEvidence,'key'|'source'|'observedAt'>{
 const outreach=supportOutreachSchema.parse(value);
 if(outreach.textsDelivered>outreach.textsSent||outreach.contactProperties>outreach.screened)throw Error('Invalid outreach counts');
 return {status:outreach.callsBudgetHeld>0?'attention':'ok',code:outreach.callsBudgetHeld>0?'outreach_budget_held':'outreach_checked',outreach,
  detail:`${outreach.screened} properties checked; owner details saved for ${outreach.contactProperties}. ${outreach.textsSent} texts sent, ${outreach.textsDelivered} delivered, ${outreach.textReplies} text replies, ${outreach.callsStarted} calls started. ${outreach.callsBudgetHeld} call jobs have a saved credit hold; this count alone does not establish the current blocker. These are recorded results, not proof the customer sees them or that a seller is interested.`};
}

/** Verified account evidence wins over guesses from a passing setup check. */
export function supportOutreachReply(messages:{role:string;content:string}[],evidence:SupportEvidence[]){
 const question=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 const textDelivery=/\b(?:texts?|messages?|sms)\b.{0,60}\b(?:deliver(?:ed|ing|y)?|receiv(?:e|ed|ing))\b|\b(?:deliver(?:ed|ing|y)?|receiv(?:e|ed|ing))\b.{0,60}\b(?:texts?|messages?|sms)\b/i.test(question);
 const source=/\b(?:cold|motivated)\b.{0,35}\b(?:leads?|sellers?)\b|\bwhere\b.{0,50}\b(?:properties|leads?)\b.{0,30}\b(?:from|coming)\b/i.test(question);
 const problemPattern=/\b(?:seller|owner)\b.{0,50}\b(?:info|information|details|contact)\b|\b(?:leads?|propert(?:y|ies)|calls?|called|calling|texts?|texting|outreach|messages?|messaging)\b.{0,60}\b(?:not|no|missing|stuck|waiting|communication)\b|\b(?:no|missing|not|never|isn[’']?t|doesn[’']?t|hasn[’']?t|aren[’']?t|didn[’']?t|won[’']?t)\b.{0,60}\b(?:leads?|seller|owner|calls?|called|calling|texts?|texting|conversations?|outreach|messages?|messaging|reach(?:ing)? out|contact(?:ing)?)\b|\bwhen will (?:the|my) bot (?:work|start|begin)\b/i;
 let issue=currentSupportIssue(messages);
 // Status answers and short follow-ups stay attached to the unresolved report,
 // including when a lead-source question came between them. New topics do not.
 if(!problemPattern.test(issue)&&(supportContinuation(question)||/^(?:yes|no|ready|running|pause bot|still\b|same\b|already\b|it says\b|i (?:still |already )?(?:need|want|have|did|tried)\b|human\b|any update\b)/i.test(question.trim()))&&!/\b(?:card|charge|billing|payment|refund|cancel|course|sign.?in|log.?in|code)\b/i.test(question)){
  const lastConfirmed=messages.findLastIndex(m=>m.role==='user'&&/\b(?:that worked|it worked|working now|fixed now|all fixed|problem solved)\b/i.test(m.content));
  issue=messages.slice(lastConfirmed+1).filter(m=>m.role==='user').findLast(m=>problemPattern.test(m.content))?.content??issue;
 }
 const problem=problemPattern.test(issue);
 if(!source&&!problem&&!textDelivery)return null;
 const check=evidence.find(e=>e.key==='outreach');
 if(textDelivery){
  const o=check?.outreach;
  const reply=!o?'I can’t verify text delivery right now, so I can’t confirm why those messages aren’t showing as delivered.':o.textsSent===0?'No sent texts are recorded for your account yet. I haven’t confirmed what is stopping them.':o.textsDelivered===0?`${o.textsSent} ${o.textsSent===1?'text was':'texts were'} accepted for sending, but none has a delivery confirmation yet. I can’t confirm that they reached the sellers or why delivery hasn’t been confirmed.`:`${o.textsDelivered} of ${o.textsSent} sent texts have a delivery confirmation. ${o.textsDelivered<o.textsSent?'I can’t confirm delivery or the reason for the missing confirmations on the others yet.':'Delivery does not confirm that a seller has read or replied to a message.'}`;
  return {reply,status:'open' as const,ai:false};
 }
 if(!check?.outreach)return {reply:'I can’t verify the seller details, calls, or texts right now, so I can’t tell what’s stopping outreach yet.',status:'open' as const,ai:false};
 const o=check.outreach;
 if(source){
  const reply=o.outboundProperties>0&&o.inboundProperties===0?'These properties are researched prospects from property data. The owners have not necessarily requested an offer or said they want to sell. Your bot contacts eligible owners to find out whether they’re interested.':o.inboundProperties>0&&o.outboundProperties===0?'These properties came from incoming seller requests. A request shows interest in discussing an offer, but it does not confirm that the seller will accept one.':'Your account can receive researched prospects and incoming seller requests. Being on the property list does not, by itself, confirm the owner wants to sell.';
  return {reply,status:'open' as const,ai:false};
 }
 const running=evidence.some(e=>e.key==='work'&&e.status==='ok'&&e.code==='not_paused');
 const manualCorrection=/\bi (?:sent|made) (?:the|that) (?:text|message|call)\b|\b(?:text|message|call)\b.{0,20}\b(?:myself|manually)\b/i.test(question)&&/\b(?:bot|ai|myself|manually)\b/i.test(question);
 if(manualCorrection)return {reply:'The message you sent yourself doesn’t confirm the bot has started.'+(running?' I can see your bot is switched on.':'')+' These totals don’t separate manual messages from automatic ones, so I can’t use that text as proof of automatic outreach.',status:'open' as const,ai:false};
 if(/^(?:ok|okay|thanks|thank you)[.!\s]*$/i.test(question.trim()))return {reply:'Understood. I haven’t confirmed a fix for the outreach issue yet.',status:'open' as const,ai:false};
 const contacts=o.contactProperties>0?`Owner details are saved for ${o.contactProperties} ${o.contactProperties===1?'property':'properties'}.`:`${o.screened} ${o.screened===1?'property has':'properties have'} been checked, but no saved owner details are recorded yet.`;
 const activity=`Your account has ${o.callsStarted} recorded call ${o.callsStarted===1?'attempt':'attempts'} and ${o.textsSent} ${o.textsSent===1?'text':'texts'} (${o.textsDelivered} delivered) so far${o.textReplies===0?'; no text replies yet':`; ${o.textReplies} text ${o.textReplies===1?'reply':'replies'} recorded`}.`;
 const paused=evidence.some(e=>e.key==='work'&&e.code==='paused')||o.progress?.status==='paused';
 const hold=paused?'Your bot is paused, so queued outreach will stay paused.':o.callsBudgetHeld>0?(o.progress?.status==='settling'?'Calls are waiting for earlier work costs to be confirmed.':o.progress?.status==='budget_reached'?'Calls are waiting because available credits don’t cover the next task.':'Some call jobs still have a saved credit hold. I haven’t confirmed whether that hold still blocks new calls.') :'';
 const alreadyDirected=messages.some(m=>m.role!=='user'&&/open a property with an owner name/i.test(m.content))||/\b(?:already|tried|still)\b.{0,60}\b(?:Leads|Texts|open|show)/i.test(question);
 const next=o.contactProperties>0?(alreadyDirected?'That doesn’t confirm the messages are displaying correctly for you. I haven’t confirmed why they’re missing.':'In Leads, open a property with an owner name and tap Texts.'):'I haven’t confirmed why owner details are missing yet.';
 // Answer a calling/texting complaint directly. Lifetime counts must not be
 // presented as today's activity, nor replaced with a request to inspect Texts.
 const communication=/\b(?:calls?|called|calling|texts?|texting|messages?|messaging|outreach)\b|\bwhen will (?:the|my) bot\b/i.test(issue)&&!/\b(?:seller|owner)\b.{0,25}\b(?:info|information|details)\b/i.test(issue);
 const timeScope=/\b(?:today|all day|this morning|this afternoon|this evening|tonight|yesterday|hours?)\b/i.test(issue)?'Those totals aren’t limited to today.':'';
 if(communication&&supportContinuation(question)&&messages.some(m=>(m.role==='assistant'||m.role==='operator')&&m.content.includes(activity)))return {reply:(running?'Your bot is switched on. ':'')+'The recorded call and text totals match the ones I shared earlier. '+(hold||'I haven’t confirmed what’s stopping new outreach, so I can’t give you a start time yet.'),status:'open' as const,ai:false};
 return {reply:(communication?[hold,activity,timeScope,!hold?'I haven’t confirmed why new outreach hasn’t started.':'']:[contacts,activity,hold,next]).filter(Boolean).join(' '),status:'open' as const,ai:false};
}
