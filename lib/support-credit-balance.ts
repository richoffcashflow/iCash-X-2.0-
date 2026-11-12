import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportDuplicateCharge,supportRenewalCancellationRequested} from './support-policy.ts';

/** Explain current account-bound availability, never infer a completed deposit
 * from customer text or confuse an outstanding commitment with a final charge. */
export function supportCreditBalanceReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(m=>m.role==='user')?.content??'';
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
