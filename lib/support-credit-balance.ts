import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportDuplicateCharge,supportRenewalCancellationRequested} from './support-policy.ts';

/** Explain current account-bound availability, never infer a completed deposit
 * from customer text or confuse an outstanding commitment with a final charge. */
export function supportCreditBalanceReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(m=>m.role==='user')?.content??'';
 const fundingDecision=/\b(?:credits?|work balance|money)\b/i.test(q)&&/\b(?:add(?:ing)?|buy(?:ing)?|purchas(?:e|ing)|top(?:ping)? up|wait(?:ing)?)\b/i.test(q)&&/\b(?:pending (?:work|tasks?|credits?)|(?:bot|automation).{0,30}(?:moving|start|restart|working|continue)|(?:start|restart|resume).{0,30}(?:bot|automation|work))\b/i.test(q);
 if(fundingDecision&&!supportDuplicateCharge(q)&&!supportRenewalCancellationRequested(q)&&!/\b(?:refund|cancel|charged|card|subscription|renewal|seller|buyer|mortgage|loan|not asking|don[’']?t need)\b/i.test(q)){
  const check=context.kind==='account'?context.evidence?.find(e=>e.key==='outreach'):undefined,p=check?.outreach?.progress;
  const verified=check?.status!=='unknown'&&p?.spendingMode==='available_balance'&&Number.isSafeInteger(p.remainingCents)&&p.remainingCents>=0&&Number.isSafeInteger(p.pendingCents)&&typeof p.pendingCents==='number'&&p.pendingCents>=0;
  const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const balance=verified?`The latest check shows ${money(p!.remainingCents)} available for new work and ${money(p!.pendingCents!)} committed to earlier work while costs are confirmed. Those commitments are not final charges. `:context.kind==='account'?'I can’t verify the current work-credit amount or pending commitments from these checks. ':'I can’t verify your account’s work credits from this guest chat. ';
  const paused=context.kind==='account'&&(p?.status==='paused'||context.evidence?.some(e=>e.key==='work'&&e.code==='paused'));
  const blocked=check?.status!=='unknown'&&p?.health?.status==='blocked';
  const state=paused?'Your bot is currently paused. ':blocked?'The latest work check still reports a blockage. ':'';
  return {reply:balance+state+'Adding credits or clearing pending costs is not a confirmed repair and does not guarantee resumed work. I haven’t confirmed a restart time. New work still depends on available credits, Run/Pause and the other eligibility checks.',status:'open',ai:false,...(context.kind==='account'&&blocked?{managementReview:true}:{})};
 }
 if(supportDuplicateCharge(q)||supportRenewalCancellationRequested(q)||/\b(?:refund|cancel|charged|card|subscription|renewal|cost|price|pricing|credit score|mortgage|loan|seller|buyer|property|house|offer|should i (?:add|buy)|can i buy|have to (?:add|buy)|how (?:do|can) i (?:add|buy))\b/i.test(q))return null;
 const current=/\b(?:how much|how many|what|check|show|see)\b/i.test(q)&&/\b(?:credits?|credit balance|work balance)\b/i.test(q)&&/\b(?:have|left|remaining|available|current|now|see|check|show)\b/i.test(q);
 const comparison=/\bavailable for new work\b/i.test(q)&&/\b(?:said|show|shows|see|different)\b/i.test(q)&&/\$\s*\d/.test(q);
 if(!current&&!comparison)return null;
 const answer=(reply:string):SupportReply=>({reply,status:'open',ai:false});
 if(context.kind!=='account')return answer('I can’t verify an account balance from this guest chat. Sign in to your workspace to view your work credits or ask Support from that account.');
 const check=context.evidence?.find(e=>e.key==='outreach'),p=check?.outreach?.progress;
 if(check?.status==='unknown'||p?.spendingMode!=='available_balance'||!Number.isSafeInteger(p.remainingCents)||p.remainingCents<0||typeof p.pendingCents!=='number'||!Number.isSafeInteger(p.pendingCents)||p.pendingCents<0)
  return answer('I can’t verify the current work-credit amount and outstanding commitments from these checks. I haven’t confirmed a new deposit or a balance change.');
 const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
 return answer(`The latest account check shows ${money(p.remainingCents)} available for new work. ${money(p.pendingCents)} is committed to earlier work while its costs are confirmed; these are not final charges. The available amount excludes those commitments, so it can differ from the balance displayed in your workspace.`+(context.handedOff||p.health?.status==='blocked'?' This balance check does not confirm that stalled work has restarted.':''));
}
