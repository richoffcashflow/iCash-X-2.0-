import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportBotWorkProblem} from './support-reply-style.ts';

/** A past call hold is not a diagnosis of today's outage. Explain the next
 * review step without blaming a personal-number edit or reciting lifetime totals. */
export function supportCallHoldReply(context:SupportContext):SupportReply|null{
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
 return {reply:'A past call was blocked by a problem with the service’s calling-number setup. I can’t confirm whether that still explains the current delay. You don’t need to change your phone settings; this needs a service review. I haven’t confirmed a fix or restart time.',status:'open',managementReview:true,ai:false};
}
