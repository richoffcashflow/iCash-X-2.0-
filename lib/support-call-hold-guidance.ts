import {supportUnansweredCallQuestion} from './support-product-guide.ts';
import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportBotWorkProblem,removeRepeatedSupportQuestions} from './support-reply-style.ts';

/** A past call hold is not a diagnosis of today's outage. Explain the next
 * review step without blaming a personal-number edit or reciting lifetime totals. */
export function supportCallHoldReply(context:SupportContext):SupportReply|null{
 const latest=context.messages.findLast(m=>m.role==='user')?.content.trim()??'';
 if(/^(?:(?:it says|the error is)[: ,]*)?(?:your |my |the )?business calling number is unavailable(?:[.!?\s]+please try again)?[.!?\s]*$/i.test(latest))return {reply:'That error concerns the service’s calling number, not a missing seller phone number. It can occur when the calling service cannot select or verify its outbound number. The exact cause still needs a service review; the error alone does not prove a current account configuration fault. Your personal contact number is separate. This chat has not restarted a call or confirmed a repair.',status:'open',managementReview:true,ai:false};
 if(supportUnansweredCallQuestion(latest))return null;
 if(context.kind!=='account')return null;
 const voice=context.evidence?.find(e=>e.key==='voice');
 if(voice?.status!=='attention'||voice.code!=='voice_business_number_mismatch')return null;
 if(context.evidence?.some(e=>e.key==='work'&&e.code==='paused'||e.key==='outreach'&&e.outreach?.progress?.status==='paused'))return null;
 const index=context.messages.findLastIndex(m=>m.role==='user');
 const question=context.messages[index]?.content??'',previous=context.messages[index-1];
 // Explicit new topics retain their existing routes, including real payment
 // complaints and personal contact edits. A number-change denial is a correction.
 if(/\b(?:credits?|balance|funds?|refund|cancel|charged|billing|payment|card|subscription|course|vip|contract|agreement|sign.?in|log.?in|code|how many|stats|statistics)\b/i.test(question))return null;
 if(/\b(?:texts?|messages?|sms|voicemail|recording)\b/i.test(question)&&! /\b(?:calls?|calling)\b/i.test(question))return null;
 const problem=supportBotWorkProblem(question)||/\b(?:not|no|never|isn[’']?t|hasn[’']?t|doesn[’']?t)\b.{0,35}\b(?:calls?|calling|outreach)\b|\b(?:calls?|calling|outreach)\b.{0,35}\b(?:stopped|stuck|blocked|not starting)\b/i.test(question);
 const followup=/^(?:so[, ]+)?(?:what (?:do|should) i do(?: now| next)?|what happens next|what(?:[’']s| is) (?:the )?next step|what (?:do you|does that) mean|i don[’']?t understand|\?+|will it start calling again(?: or do i need to change anything)?|i (?:did not|didn[’']?t) change (?:any |my |the )?(?:phone )?number(?:[, ]+(?:so[, ]+)?what happens next)?)[.!?\s]*$/i.test(question.trim());
 const priorHold=previous?.role==='assistant'&&/calling service number.*saved business number|calling-number setup/i.test(previous.content);
 if(!problem&&!(followup&&priorHold))return null;
 // Only a current, independently reported delivery/update problem adds this
 // clarification. A saved call hold cannot diagnose notifications or profile saves.
 const updateProblem=question.split(/[.!?;\n]+|\b(?:but|and)\b/i).some(part=>
  /\b(?:updates?|notifications?|alerts?)\b/i.test(part)
  &&/\b(?:phone|email)\b/i.test(part)
  &&/\b(?:not working|not arriving|not receiving|missing)\b/i.test(part)
  &&!/\b(?:not missing|no (?:longer )?missing|working now|arriving now)\b/i.test(part));
 const update=updateProblem?(/\b(?:notifications?|alerts?)\b/i.test(question)
  ?' Your phone or email notifications need a separate check. Which notification or update were you expecting, and when?'
  :' Your phone or email updates are a separate issue. Are you missing notifications, or are changes to your contact details failing to save?'):'';
 return {reply:'A past call was blocked by a problem with the service’s calling-number setup. I can’t confirm whether that still explains the current delay. Changing your personal contact number does not repair that service-number check. This needs a service review; I haven’t confirmed a fix or restart time.'+(update?' '+removeRepeatedSupportQuestions(update,context.messages):''),status:'open',managementReview:true,ai:false};
}
