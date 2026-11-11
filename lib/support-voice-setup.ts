import type {SupportContext,SupportReply} from './support-conversation.ts';

const voice=/\b(?:(?:my|own|custom|cloned) voice|voice (?:recording|clone))\b/i;
const setup=/\b(?:upload(?:ing)?|submit(?:ting)?|creat(?:e|ing)|set(?:ting)? up|setup|re[ -]?record|replace)\b/i;
const other=/\b(?:refund|cancel|charged|payment|subscription|sign[ -]?in|log[ -]?in|course|buyer|seller|contract|call recording|browser call|phone number)\b/i;
const success=/\b(?:it worked|that worked|working now|problem solved|upload(?:ed)? successfully)\b/i;
const followup=/^(?:(?:it|the (?:button|file|page|screen)) (?:(?:still|just) )?(?:says|shows|is|failed|will not|does not|won[’']?t|doesn[’']?t)\b.*|(?:i )?(?:still|already|tried)\b.*|(?:same|an?) (?:issue|error|problem)\b.*|(?:i(?:[’']m| am) )?not seeing (?:any )?progress|(?:i(?:[’']m| am) )?(?:already )?vip|i have (?:that|vip)|no|where is (?:that|the button)|what next)[.!?\s]*$/i;

/** Setup creates a clone. Playback readiness must not become an upload prerequisite.
 * Only the current issue supplies context; neither chat nor VIP checks prove a
 * provider upload succeeded, and an uncertain upload must not be resubmitted. */
export function supportVoiceSetupReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(turn=>turn.role==='user')?.content??'';
 let active=false;
 let turns:typeof context.messages=[];
 for(const turn of context.messages){
  if(turn.role==='operator'){active=false;turns=[];continue;}
  if(turn.role==='user'){
   const direct=voice.test(turn.content)&&setup.test(turn.content)&&!other.test(turn.content);
   if(success.test(turn.content)&&! /\b(?:not|but|still)\b/i.test(turn.content)){active=false;turns=[];continue;}
   if(direct){if(!active)turns=[];active=true;}
   else if(other.test(turn.content)||!followup.test(turn.content.trim())){active=false;turns=[];}
  }
  if(active)turns.push(turn);
 }
 if(!active)return null;
 const answer=(reply:string,review=false):SupportReply=>({reply,status:'open',ai:false,...(review?{managementReview:true}:{})});
 const corrected=turns.some(turn=>turn.role==='assistant'&&/\b(?:need|requires?|only)\b/i.test(turn.content)&&/\bready\b/i.test(turn.content)&&/\b(?:clone|cloned|voice)\b/i.test(turn.content)&&! /\b(?:do not|don[’']t) need\b|not (?:an? )?(?:upload )?prerequisite/i.test(turn.content));
 const intro=corrected?'The earlier instruction was incorrect. Uploading your recording creates the clone; you do not need one ready beforehand. ':'Uploading your recording creates the clone; you do not need one ready beforehand. ';
 const vip=context.kind==='account'?context.evidence?.find(check=>check.key==='vip'):null;
 if(vip?.status==='ok'&&vip.code==='vip_inactive')return answer('Custom voice is included with VIP. The account check shows VIP is not active. If you already purchased VIP, that access issue needs review; do not purchase it again to troubleshoot.');
 // The upload form exists only for empty/failed setup. A ready clone is not
 // replaceable, and unknown provider attempts must never be submitted again.
 const replacement=/\b(?:re[ -]?record|replace)\b/i;
 const replacementFollowup=/^(?:no|same (?:issue|problem)|it (?:(?:still|just) )?(?:does not|doesn[’']?t|will not|won[’']?t) (?:allow|let)(?: me)?)[.!?\s]*$/i;
 if(replacement.test(q)||replacementFollowup.test(q.trim())&&turns.some(turn=>turn.role==='user'&&replacement.test(turn.content)))return answer('A ready clone cannot be replaced from the current Custom voice panel. Choose recording appears only when setup is empty or a previous attempt explicitly failed; it is not available for a ready, creating, unconfirmed or verification-required clone. You can preview a ready clone with Play my cloned voice. If your clone is currently selected, Use standard voice switches future eligible calls to the standard voice; it does not replace the clone. This chat has not changed your voice. Your replacement request remains open for review.',true);
 if(/(?:additional )?verification (?:is )?required|needs? (?:additional )?verification/i.test(q))return answer(intro+'The verification step needs management review. Your standard voice stays available; this chat has not completed verification or activated a clone.',true);
 if(/\b(?:still creating|creating (?:my|your|the) voice|preparing|unknown|could not confirm|not ready|isn[’']?t ready)\b/i.test(q))return answer(intro+'Open Customize bot → Custom voice and select Refresh to check the original upload. While it is creating or its result is unconfirmed, do not submit the recording again. I haven’t confirmed a completed upload.');
 if(/\b(?:over|larger than|too (?:big|large))\b.{0,15}(?:4\s*MB|file)|\bfile\b.{0,25}\b(?:over|too (?:big|large))\b/i.test(q))return answer('Choose a smaller recording of your own voice in MP3, M4A, WAV or WebM format, under 4 MB. The upload problem is still unresolved.');
 if(/\b(?:confirm|check|box|consent)\b.{0,50}\b(?:own|my|your|voice)\b/i.test(q))return answer('In Customize bot → Custom voice, select the box confirming it is your own voice only if that statement is true, then select Create my voice. This chat cannot confirm consent for you or verify that creation succeeded.');
 if(/\b(?:ready|use my voice|play my cloned voice)\b/i.test(q))return answer('If Custom voice shows a ready clone, you can use Play my cloned voice to preview it, or Use my voice to select it for future eligible calls. The current panel does not accept a replacement recording for a ready clone. A ready label does not confirm that your reported problem is resolved.');
 const described=/\b(?:issue|error|failed|problem)\b/i.test(q);
 if(described){
  const asked=turns.some(turn=>turn.role==='assistant'&&/exact message|specific error/i.test(turn.content));
  return answer(intro+'If Customize bot → Custom voice shows a creating or unconfirmed upload, use Refresh to check that original attempt without submitting again. A ready clone cannot be replaced through the panel. '+(asked?'The issue is still unresolved; the original upload status and the message on that panel need review.':'What exact message appears on that panel?'),asked);
 }
 return answer(intro+'For VIP setup, Customize bot → Custom voice shows Choose recording only when setup is empty or an attempt explicitly failed. Choose your own MP3, M4A, WAV or WebM recording under 4 MB, confirm the own-voice box, then select Create my voice. A ready clone cannot be replaced through that panel. If a previous upload is still creating or unconfirmed, use Refresh instead of submitting again.');
}
