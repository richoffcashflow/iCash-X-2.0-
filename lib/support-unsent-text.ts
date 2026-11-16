import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Carry only an uninterrupted customer-reported sending failure. A screen
 * status, account total or Run selection cannot diagnose that message. */
export function supportUnsentTextReply(context:SupportContext):SupportReply|null{
 let active=false,propertyKnown=false,statusKnown=false,propertyAsked=false;
 for(const turn of context.messages){
  if(turn.role==='operator'){
   active=false;propertyKnown=false;statusKnown=false;propertyAsked=false;continue;
  }
  if(turn.role!=='user'){
   if(active&&turn.role==='assistant'&&/\b(?:which|what) property\b[^?]*\?/i.test(turn.content))propertyAsked=true;
   continue;
  }
  const q=turn.content.trim();
  const otherTopic=/\b(?:code|sign[ -]?in|log[ -]?in|email|buyer|refund|cancel\w*|subscription|payment|charged|course|contracts?|agreements?|not asking|no problem|what if|suppose)\b/i.test(q);
  const success=/\b(?:that worked|it worked|fixed now|working now|text was delivered|texts are delivered|texts? (?:are|is) (?:sending|going through))\b/i.test(q)&&!/\b(?:not|still|but)\b/i.test(q);
  const text=/\b(?:texts?|messages?|sms|texting)\b/i.test(q);
  const failure=/\b(?:not sent|unsent|not sending|aren[’']?t going through|isn[’']?t going through|not going through|did not go through|didn[’']?t go through|failed to send|(?:isn[’']?t|aren[’']?t) (?:(?:the|my) (?:ai )?bot )?(?:working or )?sending)\b/i.test(q);
  const address=/\b\d{1,6}\s+[\p{L}\s]{2,50}\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln)\b/iu.test(q);
  const status=/^(?:running|paused|it just shows (?:the |a )?date(?:\s+(?:\d|[/:.,\s]|AM|PM|\[number removed\]){1,70})?)[.!\s]*$/i.test(q);
  const frustration=/^(?:(?:bro|well|okay)[,\s]+)?(?:this (?:is frustrating|sucks)|your (?:system|support) (?:sucks|is terrible)|you aren[’']?t answering (?:my|the) question)[.!\s]*$/i.test(q);
  const repair=text&&/\b(?:still|(?:can|could|will) you (?:make|fix|help)|make my (?:ai )?bot)\b/i.test(q)&&q.length<240;
  // No-outreach reports retain the existing account-activity investigation.
  const activityOnly=/\b(?:has|have|had) not sent (?:any |a |the )?(?:texts?|messages?)\b/i.test(q);
  const direct=text&&failure&&!activityOnly;
  if(otherTopic||success||activityOnly||(!direct&&!(active&&(status||repair||frustration||address&&q.length<100)))){
   active=false;propertyKnown=false;statusKnown=false;propertyAsked=false;continue;
  }
  active=true;
  propertyKnown ||= address;
  statusKnown ||= /\b(?:not sent|unsent|date|status)\b/i.test(q);
 }
 if(!active)return null;
 const next=propertyKnown?'You do not need to repeat the property details already supplied.':propertyAsked?'The property-specific message still needs review.':statusKnown?'Which property is affected?':'Which property and message status are affected?';
 const latest=context.messages.findLast(t=>t.role==='user')?.content.trim()??'';
 const clarification=/^running[.!\s]*$/i.test(latest)?'Running is a control setting, not confirmation that a text was sent. ':/^it just shows (?:the |a )?date\b/i.test(latest)?'A displayed date alone does not confirm sending or delivery. ':'';
 const paused=context.kind==='account'&&context.evidence?.some(e=>e.key==='work'&&e.code==='paused')?' Your bot is currently paused; this review does not change that.':'';
 return {reply:clarification+'The unsent-text issue remains open. The specific message’s saved sending records need review; call-credit totals and Run status do not establish why that text is unsent or prove delivery. '+next+paused+' I have not confirmed the cause or a fix.',status:'open',managementReview:true,ai:false};
}
