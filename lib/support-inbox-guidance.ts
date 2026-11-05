import type {SupportContext,SupportReply} from './support-conversation.ts';
import {currentSupportIssue} from './support-reply-style.ts';

/** Narrow, source-backed answers for observed inbox failures. This only explains
 * controls and supplied evidence; it never changes control, sends or settles work. */
export function supportInboxGuidance(context:SupportContext):SupportReply|null{
 const q=context.messages.filter(m=>m.role==='user').at(-1)?.content??'';
 const issue=currentSupportIssue(context.messages);
 const answer=(reply:string):SupportReply=>({reply,status:'open',ai:false});
 const cancellation=/\b(?:cancel|stop|end)\b.{0,30}\b(?:subscription|renewal|membership|billing)\b/i.test(q);
 if(cancellation)return null;
 // A refund mention must not erase a simultaneous technical/account complaint.
 const voicemail=/\bvoice[ -]?mail|automated (?:greetings?|recordings?)\b/i.test(issue);
 const classification=voicemail&&/\b(?:count|counted|classif\w*|responses?|dashboard|reports?)\b/i.test(issue);
 if(classification){
  const parts=['A voicemail greeting is not a seller response or proof of interest. A dashboard that counts it as a response needs review; this chat has not corrected that count.'];
  if(/\b(?:markets?|states?|cities|dallas|locations?)\b/i.test(q))parts.push('The bot selects markets automatically; there is no customer market selector. That setting alone does not explain why your saved leads are concentrated in one city.');
  if(/\b(?:credits?|costs?|charged|deducted)\b/i.test(q))parts.push('Work credits cover completed research, contact lookup, calls and texts, even when a seller does not respond. These checks do not contain itemized costs for those calls, so I can’t quote the exact deductions or confirm they were correct.');
  if(/\brefund\b/i.test(q)&&!/\bnot limited to\b/i.test(q))parts.push('All sales are final; a reported billing or software error still needs investigation.');
  if(/\b(?:human|escalat|representative)\b/i.test(q))parts.push('There is no live transfer in this chat. The reported problems remain open.');
  return answer(parts.join('\n\n'));
 }
 if(/\b(?:refund|cancel|charged twice|duplicate charge)\b/i.test(q))return null;
 if(/\b(?:ai|bot)\b/i.test(q)&&(/\b(?:click|press|tap)\b.{0,15}\bcall\b/i.test(q)||/\bhear me\b|\bhear.{0,25}say something/i.test(q)))return answer('The property’s Call button starts a call for you to speak through your browser microphone using your business number. The seller can hear you once connected unless you mute. It does not hand that browser call to the AI or join you to an automatic AI call. Listening to a saved recording does not transmit your microphone.');
 if(/\b(?:take ?over|took over|return to (?:the )?bot|sending messages pauses|send(?:ing)? (?:a |my |the )?(?:text|message).{0,30}paus)\b/i.test(issue)){
  if(/\b(?:renew|refresh|expired|contact checks?)\b/i.test(issue))return null;
  if(/\b(?:not working|doesn[’']?t work|can[’']?t|cannot|failed|error|stuck)\b/i.test(q)&&!/\b(?:agreements?|contracts?)\b/i.test(issue))return answer('Return to bot should restore automatic control of that property; the account also needs to be on Run. If the control does not change, the problem remains unresolved. What happens when you select Return to bot?');
  const buyer=/\bbuyers?\b/i.test(issue);
  if(buyer||!/\b(?:agreements?|contracts?|auto[ -]?fill)\b/i.test(issue)){
  return answer('Take over or sending a message yourself pauses new automatic work on that property. It stays under your control until you choose Return to bot; it does not resume just because the next morning arrives. '+(buyer?'Buyer search also needs the required signed purchase agreement and checks. If shown, Let bot find a buyer returns that property to bot control. ':'')+'Your account must also be on Run. Seeing the message warning alone does not mean you already took over.');
  }
 }
 if(/\b(?:agreements?|contracts?)\b/i.test(issue)&&/\b(?:not working|isn[’']?t working|doesn[’']?t work|broken|fails?|failed|error|blank|spinning|can[’']?t (?:send|save|sign|download)|cannot (?:send|save|sign|download))\b/i.test(issue))return answer('The agreement problem is still unresolved. Which step fails: opening the draft, saving edits, sending for signatures, or opening the signing link?');
 if(/\b(?:agreements?|contracts?|form)\b/i.test(issue)&&/\b(?:auto[ -]?fill|automatically fill|fill.*automatically)\b/i.test(issue))return answer('The agreement can fill empty fields from supported saved conversation details, while keeping your edits. Review the names, price and date, and complete any missing information before sending for signatures. Returning control to the bot does not confirm that an agreement was prepared or sent.');
 if(/\b(?:resolution (?:box|note)|seller conversation|unanswered question)\b/i.test(issue)&&/\b(?:review|read|see|open)\b/i.test(issue))return answer('Use Open conversation on the seller follow-up to review Texts; switch to Calls for recordings. Only save a resolution note after you have completed the follow-up. If that conversation will not open, what happens when you select it?');
 if(/\b(?:calls?|recordings?|conversation)\b/i.test(issue)&&/\b(?:cut(?:ting)? (?:(?:it|the call|the conversation) )?short|cut off|ended early|hung up|hangs? up|only.{0,25}(?:yes|address)|nothing else|didn[’']?t hear anything else)\b/i.test(issue))return answer('A recording stopping early does not tell us whether the call ended or playback failed. Open that property’s Calls and compare the recording with its transcript and duration. Which property and call time does this affect?');
 const noReply=/\b(?:no one|nobody|none)\b.{0,40}\b(?:answer\w*|respond\w*|repl\w*)\b|\bno (?:seller )?(?:responses?|replies)\b|\b(?:sellers?|owners?)\b.{0,30}\b(?:not|aren[’']?t)\b.{0,15}\b(?:respond\w*|answer\w*|repl\w*)\b/i.test(issue);
 if(context.kind==='account'&&noReply&&!/\b(?:no (?:calls?|texts?)|not (?:calling|texting|sending)|missing (?:messages?|texts?))\b/i.test(issue)){
  const o=context.evidence?.find(e=>e.key==='outreach')?.outreach;
  return answer((o?`${o.textsDelivered} texts have delivery confirmations and ${o.textReplies} seller text replies are recorded. `:'I can’t verify seller reply counts from the available checks. ')+'Delivery and call attempts do not prove a seller answered or is interested. These totals cannot explain why a seller has not replied. Open the property’s Texts and Calls to review the actual conversation.');
 }
 if(/\bopportunity search\b/i.test(issue)&&/\b(?:not|isn[’']?t|empty|blank|reset|fix|refresh|populat\w*)\b/i.test(issue))return answer('Opportunity search counts follow the selected Today, 7 days or 30 days period. Today changes at your local day boundary; adding credits should not erase completed activity. A blank counter alone does not prove saved leads were removed. Check All activity under Your leads. Is activity also missing with 7 days selected?');
 if(context.kind==='access'){
  if(/\b(?:name|where|link|address|url)\b/i.test(q)&&/\b(?:sign[ -]?in|log[ -]?in|login)\b/i.test(q))return answer('Open https://www.geticashx.com/ and choose Sign in. Use the email on your purchase receipt.');
  if(/\b(?:paid|purchased)\b/i.test(q)&&/\b(?:not|haven[’']?t|didn[’']?t|never|wrong)\b/i.test(q)&&/\b(?:received|receive|sent|send|anything|person)\b/i.test(q))return answer('Don’t pay again. Are you missing the purchase receipt, the sign-in code, or access to the workspace after signing in?');
  const prior=context.messages.slice(0,-1).some(m=>m.role==='user'&&/\b(?:code|sign[ -]?in|access|paid|receipt)\b/i.test(m.content));
  if(prior&&/^(?:(?:ok(?:ay)?|so|but)[, ]+)*(?:remains? open until when|until when|how long|when will (?:it|this) be fixed|did i get scammed|is this a scam)[?!.\s]*$/i.test(q.trim()))return answer('Your access issue is still unresolved, and I don’t have a confirmed completion time. Don’t pay again. The purchase and sign-in records need to be matched before access can be restored; your earlier details remain in this conversation.');
 }
 return null;
}
