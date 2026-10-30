import {supportTopic,type SupportEvidence} from './support-policy.ts';
import {supportContinuation,supportSafetyOnly} from './support-reply-style.ts';

type Turn={role:string;content:string};
const inventedControl=/\b(?:start outreach|automatic outreach|bot contact|contact permissions?|communication settings)\b/i;
const instruction=/\b(?:open|go to|look (?:for|in)|check|find|tap|click|press|turn on|enable|toggle|do you see)\b/i;

/** Correct an actual bad instruction in this conversation; never manufacture an apology. */
export function supportInstructionCorrection(messages:Turn[],evidence:SupportEvidence[]){
 const question=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 if(['cancel','refund','billing','human','setup'].includes(supportTopic(question)))return null;
 const previous=messages.filter(m=>m.role==='assistant'||m.role==='operator').at(-1)?.content??'';
 if(!inventedControl.test(previous)||!instruction.test(previous)||/there (?:isn.t|is no)|doesn.t exist/i.test(previous))return null;
 if(!supportContinuation(question)&&!(/\b(?:where|find|see|show|button|setting|permission)\b/i.test(question)&&inventedControl.test(question)))return null;
 const running=evidence.some(e=>e.key==='work'&&e.status==='ok'&&e.code==='not_paused');
 return 'My earlier instruction was wrong—there isn’t a separate outreach button or contact-permission switch.'+(running?' I can see your bot is switched on.':'')+' You don’t need to hunt for that setting; it doesn’t explain the missing outreach.';
}

/** Catch observed failure modes even when the model ignores its product instructions. */
export function unsupportedSupportReply(reply:string,messages:Turn[],evidence:SupportEvidence[]){
 if(supportSafetyOnly(reply))return true;
 if(inventedControl.test(reply)&&instruction.test(reply))return true;
 if(/\b(?:wait|give it|after|within|in) (?:a (?:few|couple of)|\d+|one|two|three|several) (?:more )?(?:minutes?|hours?)\b|\b(?:should|will) (?:start|begin|resume)\b.{0,55}\b(?:soon|shortly|momentarily)\b/i.test(reply))return true;
 if(/\b(?:normal|just) (?:pause|delay|waiting)|\b(?:everything|all systems) (?:is|are) (?:working|fine|healthy)/i.test(reply))return true;
 if(/\b(?:I|we)(?:[’']m| am| are|[’']ll| will) (?:check|checking|investigate|investigating|look into|fix|fixing)\b/i.test(reply))return true;
 if(/\b(?:is|are|does|do)\b.{0,35}\b(?:bot|automation)\b.{0,35}\b(?:paused|running|active|on)\b.{0,25}\?/i.test(reply)&&evidence.some(e=>e.key==='work'&&['paused','not_paused'].includes(e.code??'')))return true;
 const latest=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 if(/\b(?:i sent|i made|manually|myself)\b/i.test(latest)&&/\b(?:bot|ai) (?:has |already )?(?:sent|called|texted|started)\b/i.test(reply))return true;
 return false;
}
