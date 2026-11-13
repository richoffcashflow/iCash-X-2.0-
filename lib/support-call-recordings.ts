import type {SupportContext,SupportReply} from './support-conversation.ts';

const subject=(text:string)=>/\bcalls?\b/i.test(text)&&(/\b(?:record(?:s|ing|ings)?|playback)\b/i.test(text)||/\bcalls?\b.{0,25}\b(?:not|never|wasn[’']?t|weren[’']?t) recorded\b/i.test(text));
const otherTopic=(text:string)=>/\b(?:custom voice|cloned? voice|voice sample|course|webinar|refund|cancel|subscription|billing|charged|sign[ -]?in|voicemail|answering[ -]machine|automated recording)\b/i.test(text);
const failure=(text:string)=>/\b(?:no|missing|unavailable|silent|failed|cannot|can[’']?t|won[’']?t|not|doesn[’']?t|didn[’']?t)\b/i.test(text);
const continuation=(text:string)=>/^(?:it (?:still )?(?:will not|won[’']?t|does not|doesn[’']?t) play|still (?:no audio|missing|not playing|the same)|same (?:issue|problem)|thanks|thank you|ok(?:ay)?|what now)[.!?\s]*$/i.test(text.trim());
const capability=(text:string)=>/\b(?:does|can|able|supports?)\b/i.test(text)&&/\brecord(?:s|ing)?\b/i.test(text);
const guide='iCash X supports call recording. Open the property’s conversation to find saved call audio. A call attempt does not guarantee an available recording; the call’s recording status is what matters.';

/** Call audio is a specific saved-result question, not an account-wide outreach
 * complaint. Keep follow-ups bounded to that subject, including guest help. */
export function supportCallRecordingReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(turn=>turn.role==='user')?.content??'';
 if(otherTopic(q)||/\b(?:press|click|tap) (?:the )?call\b|\b(?:microphone|hear me|hear (?:the )?seller|during (?:the |my )?call)\b/i.test(q))return null;
 let active=false,unresolved=false,asked=false;
 for(const turn of context.messages.slice(-12)){
  if(turn.role==='operator'){
   active=subject(turn.content)&&!otherTopic(turn.content);unresolved=active&&failure(turn.content);asked=false;continue;
  }
  if(turn.role==='assistant'){
   if(active&&/which property and call time/i.test(turn.content))asked=true;
   continue;
  }
  if(turn.role!=='user')continue;
  if(/^(?:it is working now|it worked|that worked|fixed now|problem solved)[.!\s]*$/i.test(turn.content.trim())){active=false;unresolved=false;asked=false;continue;}
  if(!otherTopic(turn.content)&&subject(turn.content)){active=true;unresolved=unresolved||failure(turn.content);continue;}
  if(active&&!otherTopic(turn.content)&&(continuation(turn.content)||capability(turn.content)&&/\brecord(?:s|ing)? audio\b/i.test(turn.content)))continue;
  active=false;unresolved=false;asked=false;
 }
 if(!active)return null;
 const result=(reply:string):SupportReply=>({reply,status:'open',ai:false});
 if(capability(q)&&!failure(q))return {...result(guide+(unresolved?' The missing recording you reported is still unresolved.':'')),routineGuidance:true};
 if(unresolved){
  if(/^(?:thanks|thank you|ok(?:ay)?)[.!\s]*$/i.test(q.trim()))return result('You’re welcome. The recording issue is still unresolved.');
  return {...result(asked?'The recording issue is still unresolved. Your earlier report is saved here; the property, call time and recording status need review before a cause or repair can be confirmed.':'Let’s check the saved result for that specific call. Which property and call time are affected, and what recording status is shown?'),...(asked?{managementReview:true}:{})};
 }
 return result(guide);
}
