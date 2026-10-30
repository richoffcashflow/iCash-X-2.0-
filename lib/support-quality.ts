import {redactSupportQuestion} from './support-policy.ts';
import {supportSafetyOnly} from './support-reply-style.ts';
import {supportContactTimingQuestion,supportContractTimingQuestion} from './support-product-clarifications.ts';

export type QualityMessage={role:string;content:string;created_at:string};
export type QualityConversation={id:string;kind:'account'|'access';subject:string;status:string;updated_at:string;messages:QualityMessage[]};
export type QualityFlag={code:'repeat'|'empty'|'mismatch'|'stalled'|'promise';label:string};
export type QualityCase=Omit<QualityConversation,'messages'>&{question:string;lastReply:string;flags:QualityFlag[];topic:string};
export type SupportQualityReport={checkedAt:string;days:number;sampled:number;limited:boolean;flagged:number;needsReview:number;topics:{topic:string;conversations:number;flagged:number}[];cases:QualityCase[]};
const normalize=(text:string)=>text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const active=(status:string)=>!['closed','resolved'].includes(status);
function topic(text:string){
 if(/\b(?:1\.0|original icash|old platform|two.month|2.month|free offer)\b/i.test(text))return 'Original platform & offers';
 if(/\b(?:refund|cancel|billing|charge|payment|minutes?|mins?|credits?)\b/i.test(text))return 'Billing & usage';
 if(/\b(?:sign.?in|log.?in|code|wrong email|checkout)\b/i.test(text))return 'Purchase & sign-in';
 if(/\b(?:contracts?|agreements?|closing|title)\b/i.test(text))return 'Contracts & closing';
 if(/\b(?:contacts?|phone numbers?|off.market|owner details)\b/i.test(text))return 'Seller contacts & lead quality';
 if(/\b(?:bot|calls?|texts?|outreach|leads?)\b/i.test(text))return 'Bot activity & leads';
 return 'Other questions';
}
const empty=(text:string)=>supportSafetyOnly(text)||/^(?:I (?:have the details|couldn.t verify your account|can.t confirm a fix|don.t have a confirmed answer)|There.s no confirmed change|I.ll keep troubleshooting this here\.?$)/i.test(text.trim());

/** Review signals, not verdicts. Never resolve cases, send messages, train from
 * customer claims, or infer that a reported platform failure is repaired. */
export function supportQualityReport(conversations:QualityConversation[],now=new Date(),limited=false):SupportQualityReport{
 const all=conversations.map(conversation=>{
  const messages=[...conversation.messages].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
  // A later operator response supersedes earlier automation for review signals.
  const recent=messages.slice(messages.findLastIndex(m=>m.role==='operator')+1);
  const replies=recent.filter(m=>m.role==='assistant'),flags:QualityFlag[]=[];
  const seen=new Set<string>();
  if(replies.some(m=>{const n=normalize(m.content);if(n.length<12)return false;if(seen.has(n))return true;seen.add(n);return false;}))flags.push({code:'repeat',label:'Repeated reply'});
  if(replies.some(m=>empty(m.content)))flags.push({code:'empty',label:'Reply needs a useful next step'});
  let question='';
  const mismatch=recent.some(m=>{
   if(m.role==='user'){question=m.content;return false;}
   return m.role==='assistant'&&((supportContactTimingQuestion(question)&&/don.t need to add listings|outreach hours/i.test(m.content))||(supportContractTimingQuestion(question)&&/Agreements are inside|choose Take over/i.test(m.content))||(/checkout/i.test(question)&&/not go through|failed|didn.t go through/i.test(question)&&/sign.in.*code|code.*sign.in/i.test(m.content)));
  });
  if(mismatch)flags.push({code:'mismatch',label:'Answer may miss the question'});
  if(replies.some(m=>/\b(?:calls?|outreach) will resume automatically\b|\b(?:we|I) (?:are |am |will be )?(?:working on|fixing) (?:it|this|the issue)\b/i.test(m.content)))flags.push({code:'promise',label:'Repair claim needs verification'});
  if(['open','escalated'].includes(conversation.status)&&now.getTime()-Date.parse(conversation.updated_at)>=24*60*60*1000)flags.push({code:'stalled',label:'Open without an update for 24+ hours'});
  const latest=messages.findLast(m=>m.role==='user')?.content??conversation.subject;
  const first=messages.find(m=>m.role==='user')?.content??latest;
  return {id:conversation.id,kind:conversation.kind,subject:redactSupportQuestion(conversation.subject).slice(0,180),status:conversation.status,updated_at:conversation.updated_at,question:redactSupportQuestion(latest).slice(0,260),lastReply:redactSupportQuestion(messages.findLast(m=>m.role==='assistant'||m.role==='operator')?.content??'').slice(0,300),flags,topic:topic(first+' '+latest)};
 });
 const topics=new Map<string,{topic:string;conversations:number;flagged:number}>();
 for(const row of all){const t=topics.get(row.topic)??{topic:row.topic,conversations:0,flagged:0};t.conversations++;if(row.flags.length)t.flagged++;topics.set(row.topic,t);}
 const cases=all.filter(row=>row.flags.length).sort((a,b)=>Number(active(b.status))-Number(active(a.status))||b.flags.length-a.flags.length||Date.parse(a.updated_at)-Date.parse(b.updated_at));
 return {checkedAt:now.toISOString(),days:7,sampled:all.length,limited,flagged:cases.length,needsReview:cases.filter(c=>active(c.status)).length,topics:[...topics.values()].sort((a,b)=>b.flagged-a.flagged||b.conversations-a.conversations),cases};
}

type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Row={id:string;subject?:string;status:string;updated_at:string};
type MessageRow=QualityMessage&{thread_id?:string;request_id?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function collectSupportQuality(db:Database,now=new Date()){
 const cutoff=new Date(now.getTime()-7*86400000).toISOString();
 const [accounts,access]=await Promise.all([
  db<Row[]>(`icash_support_threads?updated_at=gte.${cutoff}&select=id,subject,status,updated_at&order=updated_at.desc&limit=61`),
  db<Row[]>(`icash_access_help_requests?updated_at=gte.${cutoff}&select=id,status,updated_at&order=updated_at.desc&limit=41`),
 ]);
 const a=accounts.slice(0,60),b=access.slice(0,40);
 if([...a,...b].some(row=>!uuid.test(row.id)))throw Error('Invalid conversation identifier');
 const [accountMessages,accessMessages]=await Promise.all([
  a.length?db<MessageRow[]>(`icash_support_messages?thread_id=in.(${a.map(r=>r.id).join(',')})&role=in.(user,assistant,operator)&select=thread_id,role,content,created_at&order=created_at.desc&limit=600`):[],
  b.length?db<MessageRow[]>(`icash_access_help_messages?request_id=in.(${b.map(r=>r.id).join(',')})&role=in.(user,assistant,operator)&select=request_id,role,content,created_at&order=created_at.desc&limit=400`):[],
 ]);
 return supportQualityReport([
  ...a.map(row=>({...row,kind:'account' as const,subject:row.subject??'Account support',messages:accountMessages.filter(m=>m.thread_id===row.id)})),
  ...b.map(row=>({...row,kind:'access' as const,subject:'Guest support',messages:accessMessages.filter(m=>m.request_id===row.id)})),
 ],now,accounts.length>60||access.length>40||accountMessages.length===600||accessMessages.length===400);
}
