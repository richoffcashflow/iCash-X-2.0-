import type {SupportContext,SupportReply} from './support-conversation.ts';

const customVoice=/\b(?:(?:custom|cloned?|my own) voice|voice (?:clone|preview))\b/i;
const playback=/\b(?:play|playback|preview|listen|hear|recording|audio|access)\b/i;
const quality=/\b(?:sound(?:s|ing)? (?:off|bad|good|weird|natural|robotic)|scar(?:e|es|ing)|feedback|reactions?|quality)\b/i;
const failed=/\b(?:can[’']?t|cannot|could not|unable|doesn[’']?t|won[’']?t|(?:don[’']?t|do not) (?:see|hear|find)|not (?:working|playing|loading|available)|no sound|silent|missing|error|failed)\b/i;
const continuation=/^(?:(?:i(?:[’']m| am) )?(?:already )?vip(?: already)?|(?:i )?(?:still )?(?:can[’']?t|cannot|don[’']?t|do not) (?:see|find|hear|play|open)\b.*|(?:it (?:just |still )?|the button )(?:says|shows|doesn[’']?t|won[’']?t|is missing|is grey|is gray)\b.*|(?:still|same|already|i tried|i already)\b.*|(?:change|switch)(?: it)? back\b.*|(?:should|can) i (?:change|switch)(?: it)? back\b.*|(?:where|how) (?:is that|do i find that)|no (?:feedback|sound)\b.*)[.!?\s]*$/i;
const differentTopic=/\b(?:refund|cancel|subscription|payment|charged|course|contract|agreement|offer|price|deal|buyer|title|text message|sign[ -]?in|log[ -]?in|seller call|call recording|incoming call|browser call)\b/i;
const path='Open Customize bot → Custom voice → Play my cloned voice. It appears for VIP once the clone is ready and uses no work credits, even while the bot is paused.';

/** A chat cannot establish successful playback, voice quality or seller interest. */
export function supportCustomVoiceReply(context:SupportContext):SupportReply|null{
 if(context.kind!=='account')return null;
 const users=context.messages.filter(turn=>turn.role==='user');
 const q=users.at(-1)?.content??'';
 if(differentTopic.test(q)&&!customVoice.test(q))return null;
 let active=false,reportedFailure=false,scoped:string[]=[];
 for(const turn of users){
  const text=turn.content;
  if(customVoice.test(text)){
   if(!active){reportedFailure=false;scoped=[];}
   active=true;
  }else if(active&&(differentTopic.test(text)||!(quality.test(text)||continuation.test(text)||/^(?:yes|no|ok(?:ay)?|thanks|thank you)[.!?\s]*$/i.test(text.trim()))))active=false;
  if(active){scoped.push(text);if(failed.test(text)&&(playback.test(text)||continuation.test(text)))reportedFailure=true;}
 }
 if(!active||!(playback.test(q)||quality.test(q)||continuation.test(q)))return null;
 const answer=(reply:string,review=false):SupportReply=>({reply,status:review||quality.test(q)?'open':'resolved',ai:false,...(review?{managementReview:true}:{})});
 const correction=context.messages.some(turn=>turn.role==='assistant'&&customVoice.test(turn.content)&&/not supported|(?:cannot|can[’']?t|won[’']?t be able to) play|no playback/i.test(turn.content))?'The earlier reply was incorrect: custom-voice playback is supported. ':'';
 if(quality.test(q))return answer(correction+'I can’t assess how your voice sounds from this chat. No seller feedback does not prove the voice sounds good or bad. '+(reportedFailure?'Your preview still needs troubleshooting. ':path+' ')+(/\b(?:change|switch|back|original|standard)\b/i.test(q)?'To choose the standard voice, open Customize bot → Custom voice → Use standard voice.':reportedFailure?'You can check the Play my cloned voice control under Customize bot → Custom voice.':''),reportedFailure);
 if(/\b(?:change|switch)\b.{0,30}\bback\b/i.test(q))return answer('To choose the standard voice, open Customize bot → Custom voice → Use standard voice. That changes the voice for future eligible calls.'+(reportedFailure?' Your preview playback problem is still unresolved.':''),reportedFailure);
 const vip=context.evidence?.find(check=>check.key==='vip');
 if(vip?.status==='ok'&&vip.code==='vip_inactive')return answer(correction+'Custom-voice playback is a VIP feature. The account check shows VIP is not active. If you already purchased VIP, that access issue needs review; don’t purchase it again to troubleshoot.',reportedFailure);
 if(reportedFailure){
  const described=scoped.some(text=>/could not load your voice preview|could not play the audio|not ready yet|preparing your voice|no sound|silent|missing|(?:don[’']?t|do not|can[’']?t) see/i.test(text));
  return answer(correction+path+' '+(described?'The playback problem you described is still unresolved; the feature being available does not confirm it played successfully.':'What happens when you select it: a missing button, an error, or a player with no sound?'),true);
 }
 return answer(correction+path);
}
