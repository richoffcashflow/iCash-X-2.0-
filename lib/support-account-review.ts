import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportRenewalCancellationRequested} from './support-policy.ts';
import {supportVoicemailComplaint} from './support-inbox-guidance.ts';

const outreachConcern=(text:string)=>/\b(?:bot|automated|automation|research|outreach|calls?|texts?|sellers?|properties|leads?)\b/i.test(text)&&/\b(?:slow|slower|not doing much|not doing anything|no interested|no interest|haven[’']?t (?:gotten|got|had|received).{0,30}interested)\b/i.test(text);
const callerIdentity=(text:string)=>(/\b(?:caller[ -]?id|outbound number|outgoing number|business (?:phone|number)|previously purchased number)\b/i.test(text)||/\bown (?:phone )?number\b/i.test(text)&&/\b(?:bot|ai|outbound|calling|texts?|calls?)\b/i.test(text))&&/\b(?:what|which|use|using|call|calls|calling|set ?up|connect|change|disclos|show|see)\w*\b/i.test(text)||/\b(?:what|which)(?: phone)? number\b.{0,40}\b(?:calls?|calling|texts?|texting) from\b/i.test(text);
const identityGuide='Outgoing calls use a service-connected business caller ID. The phone field in Settings is your contact number, not a caller-ID selector. There is no customer control to connect a separately purchased number. These support checks don’t identify the exact outbound number for a particular call.';

/** Current account complaints take priority over incidental product keywords.
 * This only explains recorded checks; it never changes controls or sends work. */
export function supportAccountReviewReply(context:SupportContext):SupportReply|null{
 const users=context.messages.filter(m=>m.role==='user'),q=users.at(-1)?.content??'';
 const previous=context.messages.findLast(m=>m.role==='assistant'||m.role==='operator')?.content??'';
 const answer=(reply:string,managementReview=false):SupportReply=>({reply,status:'open',ai:false,...(managementReview?{managementReview:true}:{})});
 if(supportRenewalCancellationRequested(q))return null;
 if(/\b(?:refund|money back|cancel (?:my|the|this) (?:subscription|membership)|charged twice|duplicate charge)\b/i.test(q))return null;
 // Specific call-result complaints must reach their guidance before incidental
 // words such as "automated calls" and "available fix" match capability checks.
 if(supportVoicemailComplaint(q))return null;
 if(/\b(?:(?:more|extra) (?:money|credits?)|(?:add|adding|fund)\b.{0,25}\b(?:bot|account)|buy (?:more )?credits?)\b/i.test(q)&&/\b(?:contracts?|deals?|results?|work differently|work faster|better)\b/i.test(q)&&!/\b(?:purchase price|seller price|assignment fee|offer amount)\b/i.test(q))
  return answer('Adding money buys more prepaid work credits for eligible research, contact lookup, calls and texts. It does not guarantee a contract, seller response or closed deal, and it does not change the bot’s strategy. More credits do not fix a technical problem or override Pause. You don’t need to pay more to troubleshoot missing activity.');
 if(context.kind!=='account')return null;
 const o=context.evidence?.find(e=>e.key==='outreach')?.outreach;
 const work=context.evidence?.find(e=>e.key==='work');
 const paused=work?.code==='paused'||o?.progress?.status==='paused';
 const state=paused?'Your bot is paused. This chat has not resumed it or authorized new work.':work?.code==='not_paused'&&work.status==='ok'?'Your bot is switched on; that setting alone does not prove outreach is running.':'I can’t confirm the current Run/Pause setting from these checks.';
 const totals=o?`${o.callsStarted} call attempts and ${o.textsSent} texts are recorded overall, with ${o.textReplies} text replies. These totals do not prove seller interest or recent automatic outreach.`:'I can’t verify the call and text records from the available checks.';
 const voice=context.evidence?.find(e=>e.key==='voice'&&e.status==='attention');
 const blocker=paused?'The pause explains why new work is stopped now, but not why outreach was missing before it.':voice?.detail??(o?.progress?.status==='settling'?'Earlier work is awaiting final cost confirmation.':o?.progress?.status==='budget_reached'?'Available work credits do not cover the next task.':o?.progress?.health?.status==='blocked'&&o.progress.health.reason==='pending_work'?'An earlier task is awaiting confirmation.':context.evidence?.some(e=>e.key==='research_capacity'&&e.code==='research_capacity_wait'&&e.status==='attention')?'New property research is waiting for capacity.':'I haven’t verified the specific cause of the missing or slow activity.');
 const automatedQuestion=/\b(?:automated|automatic|automatically|ai|bot)\b/i.test(q)&&/\b(?:calls?|calling|sms|texts?|texting|outreach|speak)\b/i.test(q)&&/\b(?:available|availability|enabled|able|blocker|missing setup|bot to speak|bot to conduct|no recorded|0 calls|zero calls)\b/i.test(q);
 if(automatedQuestion){
  const capability='Eligible seller calls and texts can run automatically; the property’s Call button is for you to speak through your browser microphone.';
  return answer([capability,state,totals,blocker,callerIdentity(q)?'Caller ID uses a service-connected business number, not the contact-phone field in Settings; I can’t identify the exact number from these checks.':''].filter(Boolean).join('\n\n'),/\b(?:blocker|missing setup|no recorded|0 calls|zero calls|not started)\b/i.test(q));
 }
 const phoneSetupFollowup=callerIdentity(users.at(-2)?.content??'')&&/where are you|where.*trying.*number/i.test(previous)&&/^[a-z ]{2,35}[.!]?$/i.test(q.trim())&&!/\b(?:course|refund|cancel|credits?|access|vip|contract|agreement)\b/i.test(q);
 if(phoneSetupFollowup)return answer('The earlier phone-setup instruction was incorrect. '+identityGuide);
 if(callerIdentity(q))return answer(identityGuide);
 if(/\b(?:let (?:it|the bot|ai) do (?:all|most)|do(?:es)? (?:all|most of) the work|hands[ -]?off|how does (?:it|this|the bot) work for me)\b/i.test(q)&&!/\b(?:not|stopped|broken|failed|missing|error)\b/i.test(q))
  return answer('The bot handles eligible research, seller outreach and follow-up automatically on Standard as well as VIP. You still need to review seller replies and deal terms, complete required signatures, choose and verify title, and respond to closing requests. VIP adds features; it does not remove those responsibilities or guarantee a closing.');
 const operator=context.messages.findLast(m=>m.role==='operator')?.content??'';
 const operatorProblems=/\b(?:display problem|display bug|display correction|empty (?:contact )?thread|unfinished work|awaiting final|awaiting.*cost|tied to (?:earlier|unfinished) work)\b/i.test(operator)&&/\b(?:not live|not fixed|not.*confirmed|can’t.*confirm|still|blocking|needs? (?:review|resolution|repair))\b/i.test(operator);
 if(operatorProblems&&/\b(?:issue|problem|quality|responses?|replies|fixed|restored)\b/i.test(q)&&!/\b(?:contract|agreement|sign[ -]?in|course|vip|voice|refund|cancel)\b/i.test(q))
  return answer('The earlier operator review recorded unresolved problems with '+(/\b(?:display|thread)\b/i.test(operator)?'conversation visibility':'unfinished work')+(/\b(?:unfinished work|awaiting final|awaiting.*cost|tied to (?:earlier|unfinished) work)\b/i.test(operator)&&/\b(?:display|thread)\b/i.test(operator)?' and work awaiting final charges':'')+'. Those findings do not establish why sellers haven’t replied. I haven’t verified a repair or a restart time, so asking you to check the same tabs or buy more credits would not resolve the reported issue.',true);
 if(outreachConcern(q))return answer('I understand why the lack of progress is frustrating. '+state+' '+totals+' '+blocker,true);
 if(/^(?:that sucks|this sucks|that[’']?s (?:frustrating|disappointing)|nothing(?: right now)?)[.!\s]*$/i.test(q.trim())&&users.slice(-7,-1).some(m=>outreachConcern(m.content)))
  return answer(/^nothing/i.test(q)?'Understood. The activity problem you reported remains open; you do not need to repeat it.':'I understand why you’re frustrated. Your report of slow or missing activity remains unresolved; I haven’t confirmed a fix or restart time.',true);
 if(/\b(?:searching|looking) for a deal\b/i.test(q)&&/\b(?:waiting|status|says|shows)\b/i.test(q))
  return answer('“Searching for a deal” is the workspace status label. It does not prove that a task is actively running or that outreach has started. '+state+' '+totals+' '+blocker);
 if(/\b(?:what|how do i know)\b.{0,45}\b(?:currently|right now)\b.{0,25}\b(?:working|doing)\b|\bwhat is (?:my |the )?bot doing (?:currently|now)\b/i.test(q))
  return answer(state+' '+totals+' '+blocker+' Open a property’s Calls or Texts to review its saved activity. A researched property is not a confirmed interested seller.');
 return null;
}
