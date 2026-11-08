import {createHash} from 'node:crypto';
import type {QualityCase,QualityConversation} from './support-quality.ts';
import {supportCustomerConfirmedResolution,supportDisputeLanguage,supportFailedStep,supportPaymentAccessConcern,supportRepeatedFailedSteps} from './support-learning-signals.ts';

export type ImprovementCode='repeat'|'empty'|'mismatch'|'stalled'|'promise'|'failed_steps'|'operator_correction'|'unanswered'|'payment_access'|'dispute_language'|'unverified_closure';
export type ImprovementPriority='urgent'|'high'|'normal';
export type SupportImprovementReport={version:1;checkedAt:string;limited:boolean;metrics:{reviewed:number;customerConfirmed:number;closedWithoutConfirmation:number;failedSteps:number;unanswered:number;paymentAccess:number;disputeLanguage:number;operatorCorrections:number};patterns:{key:string;code:ImprovementCode;kind:'account'|'access';topic:string;conversations:number;active:number;priority:ImprovementPriority}[];candidates:{id:string;kind:'account'|'access';evidenceKey:string;status:string;priority:ImprovementPriority;codes:ImprovementCode[];latestCustomerAt:string|null}[]};
const active=(status:string)=>!['closed','resolved'].includes(status);
const rank={urgent:0,high:1,normal:2};
const priority=(codes:ImprovementCode[]):ImprovementPriority=>codes.some(c=>['dispute_language','payment_access'].includes(c))?'urgent':codes.some(c=>['mismatch','promise','failed_steps','unanswered','unverified_closure','operator_correction','stalled'].includes(c))?'high':'normal';
const correction=(text:string)=>/\b(?:earlier|previous|last) (?:reply|answer|instruction).{0,40}(?:wrong|incorrect)|\b(?:i|we) (?:found|confirmed|verified).{0,65}(?:bug|fault|display problem|incorrect|missing|failed)|\b(?:correction|corrected|incorrect instruction)\b/i.test(text);

/** Private, bounded review evidence. Patterns are hypotheses, not training labels
 * or authority to change policies, finances, identities, or customer controls. */
export function supportImprovementReport(conversations:QualityConversation[],cases:QualityCase[],now=new Date(),limited=false):SupportImprovementReport{
 const metrics={reviewed:0,customerConfirmed:0,closedWithoutConfirmation:0,failedSteps:0,unanswered:0,paymentAccess:0,disputeLanguage:0,operatorCorrections:0};
 const patterns=new Map<string,SupportImprovementReport['patterns'][number]>(),candidates:SupportImprovementReport['candidates']=[];
 const rows=new Map(cases.map(c=>[c.kind+':'+c.id,c]));
 const unique=new Map(conversations.map(c=>[c.kind+':'+c.id,c]));
 limited ||= unique.size>200;
 for(const c of [...unique.values()].slice(0,200)){
  const available=c.messages.filter(m=>['user','assistant','operator'].includes(m.role)&&Number.isFinite(Date.parse(m.created_at))&&Date.parse(m.created_at)<=now.getTime()).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
  limited ||= available.length>80||available.length!==c.messages.filter(m=>['user','assistant','operator'].includes(m.role)).length;const messages=available.slice(-80);
  const last=messages.at(-1),user=messages.findLast(m=>m.role==='user'),row=rows.get(c.kind+':'+c.id),codes=new Set<ImprovementCode>(row?.flags.map(f=>f.code)??[]);
  metrics.reviewed++;
  const confirmed=!!user&&supportCustomerConfirmedResolution(user.content);
  if(confirmed)metrics.customerConfirmed++;
  if(!active(c.status)&&!confirmed)metrics.closedWithoutConfirmation++;
  if(user&&supportRepeatedFailedSteps(messages)){codes.add('failed_steps');metrics.failedSteps++;}
  if(last?.role==='user'&&now.getTime()-Date.parse(last.created_at)>=15*60*1000){codes.add('unanswered');metrics.unanswered++;}
  const current=messages.slice(messages.findLastIndex(m=>m.role==='operator')+1);
  const unresolved=current.filter(m=>m.role==='user').slice(-3);
  if(!confirmed&&active(c.status)&&unresolved.some(m=>supportPaymentAccessConcern(m.content))){codes.add('payment_access');metrics.paymentAccess++;}
  if(!confirmed&&active(c.status)&&unresolved.some(m=>supportDisputeLanguage(m.content))){codes.add('dispute_language');metrics.disputeLanguage++;}
  if(messages.some((m,i)=>m.role==='operator'&&correction(m.content)&&messages.slice(0,i).some(p=>p.role==='assistant'))){codes.add('operator_correction');metrics.operatorCorrections++;}
  if(!active(c.status)&&!confirmed&&user&&(supportFailedStep(user.content)||supportPaymentAccessConcern(user.content))){codes.add('unverified_closure');}
  if(!codes.size)continue;
  const sorted=[...codes].sort(),p=priority(sorted),topic=row?.topic??'Other questions';
  // Stable across status-only triage changes; a new/edited message creates a new
  // version. The digest is an internal deduplication key, never proof of a fix.
  const evidenceKey=createHash('sha256').update(JSON.stringify([c.kind,c.id,messages.map(m=>[m.role,m.created_at,m.content])])).digest('hex');
  candidates.push({id:c.id,kind:c.kind,evidenceKey,status:c.status,priority:p,codes:sorted,latestCustomerAt:user?.created_at??null});
  for(const code of sorted){
   const key=['v1',c.kind,topic.toLowerCase().replace(/[^a-z0-9]+/g,'-'),code].join(':');
   const group=patterns.get(key)??{key,code,kind:c.kind,topic,conversations:0,active:0,priority:priority([code])};
   group.conversations++;if(active(c.status))group.active++;patterns.set(key,group);
  }
 }
 candidates.sort((a,b)=>rank[a.priority]-rank[b.priority]||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
 return {version:1,checkedAt:now.toISOString(),limited,metrics,patterns:[...patterns.values()].sort((a,b)=>rank[a.priority]-rank[b.priority]||b.conversations-a.conversations||a.key.localeCompare(b.key)),candidates};
}
