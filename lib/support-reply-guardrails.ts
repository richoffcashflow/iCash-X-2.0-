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
 const deniedSellerCalling=previous.split(/[.!?\n]/).some(sentence=>/\b(?:ai|bot|icash\s*x)\b.{0,55}\b(?:does not|doesn[’']t|cannot|can[’']t|will not|won[’']t|never)\s+(?:(?:makes?|places?|handle)\s+)?calls?\b/i.test(sentence)&&! /\b(?:buyers?|title|you|your phone|support|because|while|until|without|when|if|currently|right now|paused|stopped|disabled|blocked|held|credits?|no usable|no valid|opted out|suppressed)\b|\bon your account\b/i.test(sentence));
 if(deniedSellerCalling&&(supportContinuation(question)||/\b(?:bot|ai|call|calling|calls)\b/i.test(question))&&!/\b(?:buyers?|card|photo|course|sign.?in|log.?in)\b/i.test(question))return 'My earlier reply was wrong: the bot can call eligible sellers automatically. That describes the feature, not proof that a call happened on your account; actual calls need to be checked in the recorded activity.';
 if(!inventedControl.test(previous)||!instruction.test(previous)||/there (?:isn.t|is no)|doesn.t exist/i.test(previous))return null;
 if(!supportContinuation(question)&&!(/\b(?:where|find|see|show|button|setting|permission)\b/i.test(question)&&inventedControl.test(question)))return null;
 const running=evidence.some(e=>e.key==='work'&&e.status==='ok'&&e.code==='not_paused');
 return 'My earlier instruction was wrong—there isn’t a separate outreach button or contact-permission switch.'+(running?' I can see your bot is switched on.':'')+' You don’t need to hunt for that setting; it doesn’t explain the missing outreach.';
}

/** Catch observed failure modes even when the model ignores its product instructions. */
export function unsupportedSupportReply(reply:string,messages:Turn[],evidence:SupportEvidence[]){
 if(supportSafetyOnly(reply))return true;
 // Historical conversations and configuration checks do not enable SMS login.
 if(/\b(?:sign[ -]?in|log[ -]?in|login|verification code|code)\b.{0,60}\b(?:sms|text message|phone number)\b|\b(?:sms|text message|phone number)\b.{0,60}\b(?:sign[ -]?in|log[ -]?in|login|verification code|code)\b/i.test(reply))return true;
 if(/\b(?:checkout phone|text me a code|email or text)\b|\b(?:use|choose|select|switch|request|send|enter|try|verify)\b.{0,60}\b(?:text code|sms code|sms verification|phone sign[ -]?in|text sign[ -]?in|(?:verification |sign[ -]?in |login )?code (?:by|via|through) (?:sms|text))\b/i.test(reply))return true;
 if(/\b(?:you can|you may|you should|please)\s+(?:add|upload|import|enter|bring)\b.{0,45}\b(?:leads?|listings?|properties|csv)\b|\b(?:use|open|choose|select|click|tap)\b.{0,40}\b(?:lead import|csv upload|upload csv|add listing|add lead|import leads)\b/i.test(reply))return true;
 if(inventedControl.test(reply)&&instruction.test(reply))return true;
 if(/\b(?:wait|give it|after|within|in) (?:a (?:few|couple of)|\d+|one|two|three|several) (?:more )?(?:minutes?|hours?)\b|\b(?:should|will) (?:start|begin|resume)\b.{0,55}\b(?:soon|shortly|momentarily)\b/i.test(reply))return true;
 if(/\b(?:normal|just) (?:pause|delay|waiting)|\b(?:everything|all systems) (?:is|are) (?:working|fine|healthy)/i.test(reply))return true;
 if(/\b(?:I|we)(?:[’']m| am| are|[’']ll| will) (?:check|checking|investigate|investigating|look into|fix|fixing)\b/i.test(reply))return true;
 if(/\b(?:is|are|does|do)\b.{0,35}\b(?:bot|automation)\b.{0,35}\b(?:paused|running|active|on)\b.{0,25}\?/i.test(reply)&&evidence.some(e=>e.key==='work'&&['paused','not_paused'].includes(e.code??'')))return true;
 const latest=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 if(/\b(?:i sent|i made|manually|myself)\b/i.test(latest)&&/\b(?:bot|ai) (?:has |already )?(?:sent|called|texted|started)\b/i.test(reply))return true;
 return false;
}
