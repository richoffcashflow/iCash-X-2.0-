import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportDuplicateCharge} from './support-policy.ts';
import {currentSupportIssue,supportRoutineGuidanceQuestion} from './support-reply-style.ts';

/** Narrow, source-backed answers for observed inbox failures. This only explains
 * controls and supplied evidence; it never changes control, sends or settles work. */
export function supportInboxGuidance(context:SupportContext):SupportReply|null{
 const q=context.messages.filter(m=>m.role==='user').at(-1)?.content??'';
 const issue=currentSupportIssue(context.messages);
 const answer=(reply:string,routineGuidance=false):SupportReply=>({reply,status:'open',ai:false,...(routineGuidance&&supportRoutineGuidanceQuestion(q)?{routineGuidance:true as const}:{})});
 const cancellation=/\b(?:cancel|stop|end)\b.{0,30}\b(?:subscription|renewal|membership|billing)\b/i.test(q);
 const previous=context.messages.slice(0,-1).findLast(turn=>turn.role==='assistant'||turn.role==='operator')?.content??'';
 const priorCustomer=context.messages.filter(turn=>turn.role==='user').at(-2)?.content??'';
 const statementDetail=/\$\s*\d|\d[.,]\d{2}\b|\b\d{1,4}[/-]\d{1,2}\b|\b(?:both|one) (?:charges?|entries|payments?)\b/i.test(q)&&!/\?/.test(q);
 if(statementDetail&&/dates? and amounts?|statement entr(?:y|ies)|statement description/i.test(previous)&&(supportDuplicateCharge(priorCustomer)||/recogni[sz]e|authori[sz]e/i.test(priorCustomer))){
  return answer('The statement details you supplied are saved with this conversation. The purchase records need to be matched before anyone can confirm whether a charge was duplicated or made in error. You do not need to pay again.');
 }
 const disputedCharge=/\b(?:unrecogni[sz]ed|unaut[h]?ori[sz]ed|unfamiliar) (?:card )?(?:charge|payment)|\b(?:don[’']?t|do not|didn[’']?t|did not) (?:recogni[sz]e|authori[sz]e) (?:this |that |the |a |my )?(?:charge|payment)\b/i.test(q);
 if(disputedCharge){
  const next=context.kind==='account'?'The payments linked to this account can be compared with the statement entry.':'The charge needs to be matched to its purchase record.';
  const cancel=cancellation?(context.kind==='account'?' To stop future renewals, open Cancel subscription in the workspace account menu and confirm.':' Your request to stop future renewals also needs attention.'):'';
  return answer('I understand you’re reporting a charge you don’t recognize. '+next+cancel+' Please share only the date, amount and statement description. Leave out card numbers and security codes.');
 }
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
 if(/^(?:(?:can|could|will) (?:i|this)(?: help me)? )?(?:make|earn) a living(?: (?:with|using|from) (?:this|it|the bot))?[?!. ]*$/i.test(q.trim()))return answer('iCash X helps you find and follow up with sellers. Income depends on completing and closing deals. A lead or an offer does not guarantee a paycheck. You can see how a deal moves from seller to closing in the Training course.');
 const creditFollowup=/^(?:i (?:do not|don[’']?t) understand|what do you mean|why|still .{0,12}in (?:my|the) account)[!?. ]*$/i.test(q.trim());
 const progress=context.kind==='account'?context.evidence?.find(e=>e.key==='outreach')?.outreach?.progress:null;
 if(creditFollowup&&/\b(?:held|committed|reserved)\b/i.test(previous)&&progress?.spendingMode==='available_balance'&&typeof progress.pendingCents==='number'){
  const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  return answer(money(progress.remainingCents)+' is available to start new work. '+money(progress.pendingCents)+' is set aside for work already started while its final cost is checked. The balance shown can include that amount. A hold is separate from a final charge.');
 }
 const oneWayAudio=(text:string)=>/\b(?:can[’']?t|cannot|couldn[’']?t|could not|unable to|don[’']?t|not able to) hear (?:the |my |a )?(?:seller|caller|owner|other (?:person|party)|them|anything)\b/i.test(text);
 const deviceReply=/^(?:on |using |i(?:[’']m| am) (?:on|using) )?(?:(?:an? |my )?(?:iphone|ipad|android|mac|pc|safari|chrome|firefox|edge|desktop|laptop|mobile)(?:[ ,./&-]+(?:and |with |on |in |using )?)?)+[.! ]*$/i.test(q.trim());
 const previousUser=context.messages.filter(m=>m.role==='user').at(-2)?.content??'';
 if(oneWayAudio(q)||deviceReply&&oneWayAudio(previousUser)){
  const start='If the seller hears you, your microphone is working in that call. Mute controls your microphone. Check the device’s call volume and audio output, including connected headphones or Bluetooth.';
  return answer(deviceReply?start+' If audio is still missing, which property and approximate call time should support check?':start+' Which device and browser were you using?');
 }
 if(/\b(?:ai|bot)\b/i.test(q)&&(/\b(?:click|press|tap)\b.{0,15}\bcall\b/i.test(q)||/\bhear me\b|\bhear.{0,25}say something/i.test(q)))return answer('The property’s Call button starts a call for you to speak through your browser microphone using your business number. The seller can hear you once connected unless you mute. It does not hand that browser call to the AI or join you to an automatic AI call. Listening to a saved recording does not transmit your microphone.',true);
 if(/\b(?:take ?over|took over|return to (?:the )?bot|sending messages pauses|send(?:ing)? (?:a |my |the )?(?:text|message).{0,30}paus)\b/i.test(issue)){
  if(/\b(?:renew|refresh|expired|contact checks?)\b/i.test(issue))return null;
  if(/\b(?:not working|doesn[’']?t work|can[’']?t|cannot|failed|error|stuck)\b/i.test(q)&&!/\b(?:agreements?|contracts?)\b/i.test(issue))return answer('Return to bot should restore automatic control of that property; the account also needs to be on Run. If the control does not change, the problem remains unresolved. What happens when you select Return to bot?');
  const buyer=/\bbuyers?\b/i.test(issue);
  if(buyer||!/\b(?:agreements?|contracts?|auto[ -]?fill)\b/i.test(issue)){
  return answer('Take over or sending a message yourself pauses new automatic work on that property. It stays under your control until you choose Return to bot; it does not resume just because the next morning arrives. '+(buyer?'Buyer search also needs the required signed purchase agreement and checks. If shown, Let bot find a buyer returns that property to bot control. ':'')+'Your account must also be on Run. Seeing the message warning alone does not mean you already took over.',true);
  }
 }
 if(/\b(?:agreements?|contracts?)\b/i.test(issue)&&/\b(?:not working|isn[’']?t working|doesn[’']?t work|broken|fails?|failed|error|blank|spinning|can[’']?t (?:send|save|sign|download)|cannot (?:send|save|sign|download))\b/i.test(issue))return answer('The agreement problem is still unresolved. Which step fails: opening the draft, saving edits, sending for signatures, or opening the signing link?');
 if(/\b(?:agreements?|contracts?|form)\b/i.test(issue)&&/\b(?:auto[ -]?fill|automatically fill|fill.*automatically)\b/i.test(issue))return answer('The agreement can fill empty fields from supported saved conversation details, while keeping your edits. Review the names, price and date, and complete any missing information before sending for signatures. Returning control to the bot does not confirm that an agreement was prepared or sent.');
 if(/\b(?:resolution (?:box|note)|seller conversation|unanswered question)\b/i.test(issue)&&/\b(?:review|read|see|open)\b/i.test(issue))return answer('Use Open conversation on the seller follow-up to review Texts; switch to Calls for recordings. Only save a resolution note after you have completed the follow-up. If that conversation will not open, what happens when you select it?');
 if(/\b(?:calls?|recordings?|conversation)\b/i.test(issue)&&/\b(?:cut(?:ting)? (?:(?:it|the call|the conversation) )?short|cut off|ended early|hung up|hangs? up|only.{0,25}(?:yes|address)|nothing else|didn[’']?t hear anything else)\b/i.test(issue))return answer('A recording stopping early does not tell us whether the call ended or playback failed. Open that property’s Calls and compare the recording with its transcript and duration. Which property and call time does this affect?');
 const noReply=/\b(?:no one|nobody|none)\b.{0,40}\b(?:answer\w*|respond\w*|repl\w*)\b|\bno (?:seller |text )?(?:responses?|replies)\b|\b(?:not|never|haven[’']?t|hasn[’']?t|didn[’']?t|isn[’']?t|aren[’']?t|without)\b.{0,35}\b(?:replies|responses|responding|replying|a reply|a response)\b/i.test(issue);
 if(context.kind==='account'&&noReply&&!/\b(?:no (?:calls?|texts?)|not (?:calling|texting|sending)|missing (?:messages?|texts?))\b/i.test(issue)){
  const o=context.evidence?.find(e=>e.key==='outreach')?.outreach;
  const phoneQuestion=/\b(?:phone|calls?|calling|answer(?:ing)? the (?:phone|call))\b/i.test(q);
  const alreadyReviewed=/\b(?:i did|already|reviewed|checked|looked)\b/i.test(q)||/\b(?:Texts and Calls|actual conversation)\b/i.test(previous);
  if(phoneQuestion){
   const attempts=o?`${o.callsStarted} call ${o.callsStarted===1?'attempt is':'attempts are'} recorded for your account. `:'';
   return answer(attempts+'Those totals do not show how many people answered; text replies are a separate result. '+(alreadyReviewed?'Since you checked the calls already, which property and approximate call time should be reviewed?':'Open the property’s Calls to compare the outcome, recording and transcript. I can’t tell why that seller didn’t answer from these totals.'));
  }
  const next='Open the property’s Texts and Calls to review its actual conversation.';
  if(!o)return answer('I can’t verify the account’s delivery or reply records right now. '+next);
  const replies=o.textReplies===1?'1 seller text reply is recorded.':o.textReplies+' seller text replies are recorded.';
  if(o.textsSent>0&&o.textsDelivered===0)return answer(o.textsSent+' '+(o.textsSent===1?'text was':'texts were')+' accepted for sending. 0 texts have delivery confirmations and '+replies+' I can’t confirm that the texts reached sellers. '+next);
  return answer(o.textsDelivered+' texts have delivery confirmations and '+replies+' Delivery and call attempts do not prove a seller answered or is interested. '+next);
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
