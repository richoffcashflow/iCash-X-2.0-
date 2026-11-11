import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportMissingActivityConcern,supportCurrentResearchQuestion} from './support-account-review.ts';

const confirmation=(text:string)=>/^(?:(?:can|could) (?:you|u) (?:please )?confirm(?: (?:it|that|this))?|(?:please )?check again|is (?:it|this|that) fixed(?: yet)?|why (?:(?:hasn[’']t) (?:it|this|that)|has (?:it|this|that) not) been (?:fixed|rectified))[?!.\s]*$/i.test(text.trim());
const repairExpectation=(text:string)=>/^(?:so )?(?:(?:when )?will (?:it|this|the (?:issue|problem|bot)) be|is (?:it|this|the (?:issue|problem|bot)) going to be|(?:it|this|the (?:issue|problem)) (?:is going to|will) be) (?:fixed|repaired)(?: so (?:i can (?:start )?(?:getting|receiving) leads(?: and (?:the |my )?bot can (?:start )?working)?|(?:the |my )?bot can (?:start )?work(?:ing)?))?[?!.\s]*$/i.test(text.trim());
const unresolvedOperatorActivity=(text:string)=>/\bno completed (?:property )?(?:research|work)\b/i.test(text)&&/\b(?:investigation|management review|case remains open)\b/i.test(text)&&/\b(?:no|not|haven[’']t|can[’']t)\b.{0,40}\b(?:confirmed|verified|restart|completion)\b/i.test(text)&&!/\b(?:issue|problem|case) (?:is |was )?(?:now )?(?:fixed|resolved|closed)\b|\bworking now\b|\bwork (?:has )?resumed\b/i.test(text);
const activity=(text:string)=>supportMissingActivityConcern(text)||supportCurrentResearchQuestion(text)||/^(?:(?:my|the) )?(?:ai bot|bot|ai) (?:is not|isn[’']t|is still not) working[.!\s]*$/i.test(text.trim())||/^is (?:my |the )?(?:ai bot|bot|ai) (?:really |actually )?(?:working|running)(?: now)?[?!\s]*$/i.test(text.trim());
const reviewContinuation=(text:string)=>/^(?:why|how long does it (?:usually )?take to (?:receive|get) an answer|i (?:need|want) to (?:speak|talk) to a (?:real|live|human) support (?:agent|person)|(?:ok(?:ay)?|thanks|thank you))[?!.\s]*$/i.test(text.trim());

/** A short confirmation needs the immediately continuing activity issue.
 * Assistant wording supplies no facts; unrelated operator findings and topics stop it. */
export function supportActivityConfirmation(context:SupportContext):SupportReply|null{
 const index=context.messages.findLastIndex(turn=>turn.role==='user');
 const repair=repairExpectation(context.messages[index]?.content??'');
 if(context.kind!=='account'||index<1||!confirmation(context.messages[index].content)&&!repair)return null;
 let bound=false;
 for(const turn of context.messages.slice(Math.max(0,index-20),index).reverse()){
  if(turn.role==='operator'){
   // A trusted unresolved activity finding can bind a repair follow-up, but
   // fresh checks below supply current facts. Other operator findings stop it.
   if(!repair||!unresolvedOperatorActivity(turn.content))return null;
   bound=true;break;
  }
  if(turn.role!=='user')continue;
  if(activity(turn.content)){bound=true;break;}
  if(!confirmation(turn.content)&&!repairExpectation(turn.content)&&!(context.handedOff&&reviewContinuation(turn.content)))return null;
 }
 if(!bound)return null;
 const work=context.evidence?.find(check=>check.key==='work');
 const check=context.evidence?.find(check=>check.key==='outreach'&&check.status!=='unknown');
 const outreach=check?.outreach,progress=outreach?.progress;
 let detail:string;
 if(work?.code==='paused'&&work.status==='attention'||progress?.status==='paused'){
  detail='Your bot is currently paused, so new work is stopped. That does not explain the earlier lack of progress before the pause or confirm it has been repaired. This chat has not changed your controls.';
 }else if(progress?.status==='settling'||progress?.health?.status==='blocked'&&progress.health.reason==='pending_work'){
  detail='The latest activity check shows earlier work still awaiting confirmation. I can confirm that remaining hold, but not a repair or restart time. The original work result needs review before this can be called fixed.';
 }else if(progress?.health?.status==='blocked'&&progress.health.reason==='no_completed_work'){
  detail='The latest activity check still flags no completed work. That confirms the missing progress, but not its cause or a restart time. This needs service-side investigation; you do not need to repeat setup steps or buy more credits to troubleshoot it.';
 }else if(outreach&&Number.isSafeInteger(outreach.callsStarted)&&Number.isSafeInteger(outreach.textsSent)){
  detail=`The saved records show ${outreach.callsStarted} call attempts and ${outreach.textsSent} texts overall. Those totals do not confirm that new work is running or that the earlier problem is fixed. Current task results still need to be checked.`;
 }else{
  detail='I can’t verify current activity from the available checks, so I can’t confirm a repair or restart time. Your earlier report still needs investigation; you do not need to repeat the same troubleshooting steps.';
 }
 return {reply:detail,status:'open',ai:false,managementReview:true};
}
