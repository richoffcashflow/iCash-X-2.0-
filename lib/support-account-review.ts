import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportRenewalCancellationRequested} from './support-policy.ts';
import {supportVoicemailComplaint} from './support-inbox-guidance.ts';

const existingOutreachConcern=(text:string)=>/\b(?:ai|bot|automated|automation|research|outreach|calls?|texts?|sellers?|properties|leads?)\b/i.test(text)&&/\b(?:slow|slower|not doing much|not (?:been )?doing anything|isn[’']?t doing anything|hasn[’']?t been doing anything|no interested|no interest|haven[’']?t (?:gotten|got|had|received).{0,30}interested)\b/i.test(text);
/** A complaint about absent work is not proof of its cause. Keep the subject
 * and failure in one sentence, and let an explicit successful result reset it. */
export function supportMissingActivityConcern(text:string){
 if(/\b(?:(?:it|(?:the |my )?(?:bot|ai)) (?:is )?working (?:now|fine|well)|problem solved|fixed now|all fixed)[.!\s]*$/i.test(text)&&!/\b(?:not working (?:now|fine|well)|not fixed|isn[’']?t working (?:now|fine|well))\b/i.test(text))return false;
 // These whole-work complaints must not fall through to model guesses about
 // eligible inventory. A stopped seller contact or browser is a separate issue.
 if(/^(?:why (?:did|has) (?:my|the) (?:ai )?bot stop(?:ped)?(?:[^.!?\n]{0,70}\b(?:not|didn[’']?t) pause it)?|(?:my|the) (?:ai )?bot (?:has )?stopped (?:by itself|on its own))[?!.\s]*$/i.test(text.trim()))return true;
 if(/\b(?:my|the) (?:ai )?bot (?:is |says it is )?(?:on|running|active)\b[^.!?\n]{0,35}\b(?:not|isn[’']?t) (?:running|working)\b/i.test(text))return true;
 if(/\b(?:my|the) (?:ai )?bot (?:is )?taking (?:so |too )?long to find (?:a |any )?deals?\b/i.test(text))return true;
 if(/\b(?:my|the) (?:ai )?bot\b[^.!?\n]{0,25}\b(?:only|still)\b[^.!?\n]{0,25}\b(?:leads|properties) from (?:last week|yesterday|last month)\b/i.test(text))return true;
 // A running workspace with no progress is an activity complaint. Require
 // that complete statement, not unrelated browser/video or software updates.
 if(/\b(?:app|apps|workspace|bot|ai) (?:is|has been|have been|was|had been) running\b[^.!?\n]{0,65}\b(?:without (?:any )?|no )(?:movement|progress|activity)(?: or updates?)?[.!?\s]*$/i.test(text))return true;
 // Missing property research must use account evidence. Aggregate history
 // cannot answer whether new work happened today, even when Run is enabled.
 if(/\b(?:my|the) (?:bot|ai) (?:(?:has |did |is )?not|hasn[’']?t|didn[’']?t|isn[’']?t) (?:look(?:ed|ing)? up|research(?:ed|ing)?|find(?:ing)?|found) (?:any )?(?:new )?(?:properties|leads)\b/i.test(text))return true;
 return /\b(?:early|earlier|previous|unfinished) work (?:is )?(?:awaiting|waiting for) (?:final (?:cost )?confirmation|confirmation|costs?)\b|\b(?:early|earlier) work is awaiting\b/i.test(text)||existingOutreachConcern(text)||/\b(?:ai|bot|automation)\b[^.!?]{0,85}\b(?:not do(?:ing)? anything|didn[’']?t do anything|did not do anything|has(?:n[’']?t| not) done anything|nothing (?:(?:has|had) )?(?:happened|happens|occurred|occured))\b/i.test(text);
}
const outreachConcern=supportMissingActivityConcern;
const activityPage=(text:string)=>/^(?:(?:on )?the |on )?(?:all activity|your leads|home|dashboard)(?: (?:page|screen|view))?[.!\s]*$/i.test(text.trim());
const currentActivityQuestion=(text:string)=>/^is (?:my |the )?(?:ai bot|bot|ai) (?:really |actually )?(?:working|running|active)(?: (?:right )?now)?[?!\s]*$/i.test(text.trim());
// Present research-status questions need account evidence, not the general
// lead-import guide. Anchoring keeps capability, geography and other objects out.
export const supportCurrentResearchQuestion=(text:string)=>/^is (?:my |the )?(?:ai bot|bot|ai) (?:(?:actively|currently|actually|really) )?(?:finding|searching for|looking for|researching) (?:new )?(?:leads|properties)(?: (?:right )?now)?[?!\s]*$/i.test(text.trim());
const activityProofQuestion=(text:string)=>/\b(?:how|when)(?: can| do| will)? i (?:tell|know|see)\b.{0,35}\b(?:ai|bot)\b.{0,30}\b(?:doing (?:anything|something)|working|work|active)\b/i.test(text);
function missingActivityFollowup(context:SupportContext){
 const turns=context.messages.slice(-9),latest=turns.at(-1);
 const previous=turns.at(-2);
 const olderLeads=/^(?:yes[, ]+(?:but )?)?(?:it[’']?s|it is|they are|they[’']re|these are|those are)(?: all)? from (?:last week|yesterday|last month)[.!?\s]*$/i.test(latest?.content.trim()??'');
 const notRunning=/^(?:it says (?:it[’']?s|it is|its) |it is |it[’']?s )(?:on|running|active)[, ]+but (?:it is |it[’']?s |it )?not (?:running|working)[.!?\s]*$/i.test(latest?.content.trim()??'');
 if(latest?.role==='user'&&previous?.role==='assistant'&&
  (notRunning||olderLeads&&/\b(?:leads|properties)\b/i.test(previous.content)&&previous.content.includes('?'))){
  for(const turn of turns.slice(0,-1).reverse()){
   if(turn.role==='operator')break;
   if(turn.role!=='user')continue;
   if(outreachConcern(turn.content))return true;
   if(!/^(?:yes|no|running|it is running|it[’']s running)[.!\s]*$/i.test(turn.content.trim()))break;
  }
 }
 if(latest?.role!=='user'||!activityPage(latest.content)&&!activityProofQuestion(latest.content))return false;
 // A page name is a detail only after a matching question. Never carry an
 // earlier complaint across an operator finding or another customer topic.
 for(let i=turns.length-2;i>=0;i--){
  const turn=turns[i];
  if(turn.role==='operator')return false;
  if(turn.role!=='user')continue;
  if(outreachConcern(turn.content)){
   const reply=turns[i+1];
   return !activityPage(turns[i+2]?.content??'')||reply?.role==='assistant'&&/\b(?:which|what)\b.{0,30}\b(?:page|screen|view)\b/i.test(reply.content)&&reply.content.includes('?');
  }
  if(!activityPage(turn.content)&&!activityProofQuestion(turn.content))return false;
 }
 return false;
}
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
 // These existing funding-banner labels describe a status refresh, not a
 // pending checkout or proof that a task started. Never infer paid state from a quote.
 if(/\bcredits added\b/i.test(q)&&/\b(?:checking your bot[’']?s status|let[’']?s get to work)\b/i.test(q)&&!/\b(?:checkout|sign[ -]?in|code|card|charged|charges|subscription|membership|access|voice|agreements?|contracts?|unrecogni[sz]ed|unauthorized)\b/i.test(q)){
  const explanation='Those notices describe added credits and a bot-status refresh, not a pending payment. They do not prove that work has started, and you do not need to pay again to troubleshoot them.';
  if(context.kind!=='account')return answer(explanation+' I can’t verify your account’s current activity from this guest chat.');
  const work=context.evidence?.find(e=>e.key==='work'&&e.status!=='unknown');
  const progress=context.evidence?.find(e=>e.key==='outreach'&&e.status!=='unknown')?.outreach?.progress;
  if(work?.code==='paused'||progress?.status==='paused')return answer(explanation+' Your bot is currently paused. This chat has not changed that control.');
  if(progress?.status==='settling'||progress?.health?.status==='blocked'&&progress.health.reason==='pending_work')return answer(explanation+' The latest activity check shows earlier work awaiting confirmation. That still needs review; no restart time is confirmed.',true);
  if(progress?.health?.status==='blocked')return answer(explanation+' The latest activity check flags work as blocked. Earlier recorded activity does not establish that it is progressing now. This needs investigation; no repair or restart time is confirmed.',true);
  return answer(explanation+(progress?' Check the property’s saved calls and texts for actual results; the notice alone cannot confirm current progress.':' I can’t verify current activity from the available checks.'));
 }
 if(context.kind!=='account')return null;
 const o=context.evidence?.find(e=>e.key==='outreach')?.outreach;
 const work=context.evidence?.find(e=>e.key==='work');
 const paused=work?.code==='paused'||o?.progress?.status==='paused';
 const state=paused?'Your bot is paused. This chat has not resumed it or authorized new work.':work?.code==='not_paused'&&work.status==='ok'?'Your bot is switched on; that setting alone does not prove outreach is running.':'I can’t confirm the current Run/Pause setting from these checks.';
 const totals=o?`${o.callsStarted} call attempts and ${o.textsSent} texts are recorded overall, with ${o.textReplies} text replies. These totals do not prove seller interest or recent automatic outreach.`:'I can’t verify the call and text records from the available checks.';
 const voice=context.evidence?.find(e=>e.key==='voice'&&e.status==='attention');
 const blocker=paused?'The pause explains why new work is stopped now, but not why outreach was missing before it.':voice?.detail??(o?.progress?.status==='settling'?'Earlier work is awaiting final cost confirmation.':o?.progress?.status==='budget_reached'?'Available work credits do not cover the next task.':o?.progress?.health?.status==='blocked'&&o.progress.health.reason==='pending_work'?'An earlier task is awaiting confirmation.':o?.progress?.health?.status==='blocked'&&o.progress.health.reason==='no_completed_work'?'The saved checks report no completed work and flag the activity as blocked; I haven’t verified the specific cause or a restart time.':context.evidence?.some(e=>e.key==='research_capacity'&&e.code==='research_capacity_wait'&&e.status==='attention')?'New property research is waiting for capacity.':'I haven’t verified the specific cause of the missing or slow activity.');
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
 const runningFollowup=outreachConcern(users.at(-2)?.content??'')&&/\b(?:run|running|paused)\b/i.test(previous)&&previous.includes('?')&&/^(?:it(?:[’']s| is)|the bot is|my bot is) (?:running|on)(?:[;,. ]+(?:(?:it has )?the )?green light(?: is)? on)?[.!\s]*$/i.test(q.trim());
 if(outreachConcern(q)||runningFollowup||missingActivityFollowup(context))return answer('I understand why the lack of progress is frustrating. '+state+' '+totals+' '+blocker+(activityProofQuestion(q)?' Check recorded calls and texts on the property; a Run label or a researched lead does not prove recent automatic outreach.':''),true);
 if(/^(?:that sucks|this sucks|that[’']?s (?:frustrating|disappointing)|nothing(?: right now)?)[.!\s]*$/i.test(q.trim())&&users.slice(-7,-1).some(m=>outreachConcern(m.content)))
  return answer(/^nothing/i.test(q)?'Understood. The activity problem you reported remains open; you do not need to repeat it.':'I understand why you’re frustrated. Your report of slow or missing activity remains unresolved; I haven’t confirmed a fix or restart time.',true);
 if(/\b(?:searching|looking) for a deal\b/i.test(q)&&/\b(?:waiting|status|says|shows)\b/i.test(q))
  return answer('“Searching for a deal” is the workspace status label. It does not prove that a task is actively running or that outreach has started. '+state+' '+totals+' '+blocker);
 if(supportCurrentResearchQuestion(q)){
  const research=o?`${o.screened} properties checked are recorded overall. These checks do not confirm that a research task is running right now.`:'I can’t verify current research activity from these checks.';
  const blocked=o?.progress?.health?.status==='blocked';
  return answer(state+' '+research+' '+totals+(paused||blocked||voice||o?.progress?.status==='settling'||o?.progress?.status==='budget_reached'?' '+blocker:''),blocked);
 }
 if(currentActivityQuestion(q)||activityProofQuestion(q)||/\b(?:what|how do i know)\b.{0,45}\b(?:currently|right now)\b.{0,25}\b(?:working|doing)\b|\bwhat is (?:my |the )?bot doing (?:currently|now)\b/i.test(q))
  return answer(state+' '+totals+' '+blocker+(o?.progress?.health?.status==='blocked'?'':' Open a property’s Calls or Texts to review its saved activity. A researched property is not a confirmed interested seller.'),o?.progress?.health?.status==='blocked');
 return null;
}
