import {redactSupportQuestion} from './support-policy.ts';
import {supportSafetyOnly} from './support-reply-style.ts';
import {supportContactTimingQuestion,supportContractTimingQuestion} from './support-product-clarifications.ts';
import {supportLeadImportQuestion} from './support-lead-policy.ts';
import {supportBotWorkProblem} from './support-reply-style.ts';
import {supportProductConflict} from './support-product-conflicts.ts';

export type QualityMessage={role:string;content:string;created_at:string};
export type QualityConversation={id:string;kind:'account'|'access';subject:string;status:string;updated_at:string;messages:QualityMessage[]};
export type QualityFlag={code:'repeat'|'empty'|'mismatch'|'stalled'|'promise';label:string};
export type QualityCase=Omit<QualityConversation,'messages'>&{question:string;lastReply:string;flags:QualityFlag[];topic:string};
export type QualityScope='unresolved'|'recent';
export type SupportQualityReport={checkedAt:string;days:number;sampled:number;limited:boolean;flagged:number;needsReview:number;topics:{topic:string;conversations:number;flagged:number}[];cases:QualityCase[];page?:{scope:QualityScope;snapshotAt:string;nextCursor:string|null;messagesLimited:boolean}};
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
const empty=(text:string)=>supportSafetyOnly(text)||(!text.includes('?')&&/^(?:I (?:have the details|couldn.t verify your account|can.t confirm a fix|don.t have a confirmed answer)|There.s no confirmed change|I.ll keep troubleshooting this here\.?$)/i.test(text.trim()));

/** Review signals, not verdicts. Never resolve cases, send messages, train from
 * customer claims, or infer that a reported platform failure is repaired. */
export function supportQualityReport(conversations:QualityConversation[],now=new Date(),limited=false,includeUnflagged=false):SupportQualityReport{
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
   if(m.role==='assistant'&&supportProductConflict(m.content,question))return true;
   if(m.role==='assistant'&&/\b(?:company|business|my name|introduce myself)\b/i.test(question)&&/don.t need to add listings|upload properties/i.test(m.content))return true;
   if(m.role==='assistant'&&/\bbuyer\b/i.test(question)&&/\b(?:purchase agreement|contract)\b/i.test(question)&&/Seller is ready for an agreement/i.test(m.content))return true;
   if(m.role==='assistant'&&/\b(?:can you check|please check|check it|check that|what (?:is|are) (?:the|this|that)?\s*\$?10|what.*dollars.*for)\b/i.test(question)&&/what are you trying to do|don.t have a confirmed answer/i.test(m.content))return true;
   return m.role==='assistant'&&((supportContactTimingQuestion(question)&&/don.t need to add listings|outreach hours/i.test(m.content))||(supportContractTimingQuestion(question)&&/Agreements are inside|choose Take over/i.test(m.content))||(/checkout/i.test(question)&&/not go through|failed|didn.t go through/i.test(question)&&/sign.in.*code|code.*sign.in/i.test(m.content))||(supportBotWorkProblem(question)&&/sign.in step|passwords and sign.in codes/i.test(m.content))||(supportLeadImportQuestion(question)&&!/cannot|can.t|not (?:available|supported|a feature)/i.test(m.content)));
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
 const flagged=all.filter(row=>row.flags.length);
 const cases=(includeUnflagged?all:flagged).sort((a,b)=>Number(active(b.status))-Number(active(a.status))||b.flags.length-a.flags.length||Date.parse(a.updated_at)-Date.parse(b.updated_at));
 return {checkedAt:now.toISOString(),days:7,sampled:all.length,limited,flagged:flagged.length,needsReview:flagged.filter(c=>active(c.status)).length,topics:[...topics.values()].sort((a,b)=>b.flagged-a.flagged||b.conversations-a.conversations),cases};
}

type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Row={id:string;subject?:string;status:string;created_at:string;updated_at:string};
type MessageRow=QualityMessage&{thread_id?:string;request_id?:string};
type Boundary={at:string;id:string};
type Position=Boundary|'done'|null;
type QualityCursor={version:1;scope:QualityScope;snapshotAt:string;account:Position;access:Position};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const pageSize=10,messageLimit=40;
function readCursor(scope:QualityScope,raw:string|undefined,now:Date):QualityCursor{
 if(!raw)return {version:1,scope,snapshotAt:now.toISOString(),account:null,access:null};
 try{
  if(raw.length>1200)throw Error();
  const value=JSON.parse(raw) as QualityCursor;
  const position=(v:Position)=>v===null||v==='done'||(v&&typeof v==='object'&&Object.keys(v).sort().join(',')==='at,id'&&timestamp(v.at)&&uuid.test(v.id)&&Date.parse(v.at)<=Date.parse(value.snapshotAt));
  if(Object.keys(value).sort().join(',')!=='access,account,scope,snapshotAt,version'||value.version!==1||value.scope!==scope||!timestamp(value.snapshotAt)||Date.parse(value.snapshotAt)>now.getTime()||!position(value.account)||!position(value.access))throw Error();
  return value;
 }catch{throw Error('Invalid support quality cursor');}
}
/** Read-only keyset pages over persisted cases. Creation time and ID are immutable:
 * a new reply cannot move an unreviewed case behind the cursor. Restart includes
 * cases created or reopened during the review. Each case gets its own bounded
 * message read so one long conversation cannot consume another case's allowance. */
export async function collectSupportQuality(db:Database,now=new Date(),options:{scope?:QualityScope;cursor?:string}={}){
 const scope=options.scope??'unresolved';
 if(!['unresolved','recent'].includes(scope))throw Error('Invalid support quality scope');
 const cursor=readCursor(scope,options.cursor,now);
 const cutoff=new Date(Date.parse(cursor.snapshotAt)-7*86400000).toISOString();
 const readPage=async(kind:'account'|'access')=>{
  const position=cursor[kind];if(position==='done')return [];
  const params=new URLSearchParams({select:kind==='account'?'id,subject,status,created_at,updated_at':'id,status,created_at,updated_at',order:'created_at.asc,id.asc',limit:String(pageSize+1),created_at:'lte.'+cursor.snapshotAt});
  if(scope==='unresolved')params.set('status','in.(open,escalated,waiting_on_customer)');else params.set('updated_at','gte.'+cutoff);
  if(position)params.set('or',`(created_at.gt.${position.at},and(created_at.eq.${position.at},id.gt.${position.id}))`);
  const rows=await db<Row[]>(`${kind==='account'?'icash_support_threads':'icash_access_help_requests'}?${params}`);
  if(rows.some(row=>!uuid.test(row.id)||!timestamp(row.created_at)))throw Error('Invalid conversation identifier');
  return rows;
 };
 const [accounts,access]=await Promise.all([readPage('account'),readPage('access')]);
 const selected=[...accounts.slice(0,pageSize).map(row=>({...row,kind:'account' as const})),...access.slice(0,pageSize).map(row=>({...row,kind:'access' as const}))];
 const conversations:QualityConversation[]=[];let messagesLimited=false;
 for(let offset=0;offset<selected.length;offset+=5){
  const batch=await Promise.all(selected.slice(offset,offset+5).map(async row=>{
   const column=row.kind==='account'?'thread_id':'request_id';
   const params=new URLSearchParams({[column]:'eq.'+row.id,role:'in.(user,assistant,operator)',select:column+',role,content,created_at',order:'created_at.desc,id.desc',limit:String(messageLimit+1)});
   const messages=await db<MessageRow[]>(`${row.kind==='account'?'icash_support_messages':'icash_access_help_messages'}?${params}`);
   const own=messages.filter(message=>message[column]===row.id);messagesLimited ||= own.length>messageLimit;
   return {...row,subject:row.subject??(row.kind==='account'?'Account support':'Guest support'),messages:own.slice(0,messageLimit)};
  }));
  conversations.push(...batch);
 }
 const after=(rows:Row[]):Position=>rows.length>pageSize?{at:rows[pageSize-1].created_at,id:rows[pageSize-1].id}:'done';
 const next={...cursor,account:after(accounts),access:after(access)};
 const nextCursor=next.account==='done'&&next.access==='done'?null:JSON.stringify(next);
 const report=supportQualityReport(conversations,now,!!nextCursor||messagesLimited,scope==='unresolved');
 return {...report,page:{scope,snapshotAt:cursor.snapshotAt,nextCursor,messagesLimited}};
}
