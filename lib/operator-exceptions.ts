import {createHash} from 'node:crypto';
import {z} from 'zod';

import {exceptionSources,exceptionLabels,exceptionPageSize,exceptionMaxPage,type ExceptionSource,type ExceptionItem,type ExceptionSection,type ExceptionSnapshot} from './operator-exception-types.ts';
export const exceptionQuery = z.object({source:z.enum(exceptionSources).optional(),page:z.coerce.number().int().min(0).max(exceptionMaxPage).default(0)}).strict();
export type ExceptionDb = <T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
const id=z.string().uuid(),stamp=z.string().refine(s=>Number.isFinite(Date.parse(s)),'Invalid recorded time');
const base={id,account_id:id,created_at:stamp};
const schemas:Record<ExceptionSource,z.ZodTypeAny>={
 billing:z.object({...base,state:z.enum(['pending','active','payment_failed','stop_requested','stopped']),mode:z.enum(['live','test']),reconciled_at:stamp.nullable()}),
 costs:z.object({account_id:id,operation_key:z.string().min(1).max(500),state:z.enum(['reserved','dispatched','settled','cancelled']),cost_basis:z.enum(['unreconciled','estimated','verified']),created_at:stamp}),
 texts:z.object({...base,state:z.enum(['ready','dispatching','accepted','delivered','needs_review','received','cancelled']),direction:z.enum(['incoming','outgoing']),updated_at:stamp}),
 emails:z.object({...base,state:z.enum(['ready','dispatching','accepted','needs_review','received']),direction:z.enum(['incoming','outgoing']),delivery_state:z.enum(['delivered','bounced','complained','delivery_delayed','failed']).nullable(),updated_at:stamp}),
 voice_jobs:z.object({...base,state:z.enum(['ready','issued','dispatching','dispatched','held','canceled']),updated_at:stamp}),
 call_results:z.object({...base,state:z.enum(['waiting','complete','review'])}),
 property_checks:z.object({...base,state:z.literal('failed')}),
 title_tasks:z.object({...base,state:z.enum(['scheduled','needs_review','done','dismissed','cancelled']),kind:z.enum(['follow_up','reply_review','deadline']),due_date:z.string().nullable(),email_state:z.enum(['waiting','issued','dispatching','sent','needs_review']),updated_at:stamp}),
 attention_emails:z.object({...base,state:z.enum(['claimed','accepted','delivered','needs_review','cancelled','bounced','complained','failed','suppressed'])}),
 support:z.object({...base,status:z.enum(['open','escalated','waiting_on_customer','resolved']),updated_at:stamp}),
};
const tables:Record<ExceptionSource,string>={billing:'icash_daily_plans',costs:'icash_operation_spend',texts:'icash_text_messages',emails:'icash_deal_emails',voice_jobs:'icash_voice_jobs',call_results:'icash_live_conversations',property_checks:'icash_screening_jobs',title_tasks:'icash_title_tasks',attention_emails:'icash_attention_emails',support:'icash_support_threads'};
/** Match existing title scheduling: date-only, America/Chicago; never promote a suggested date. */
export function titleDateWindow(now:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 const today=`${part('year')}-${part('month')}-${part('day')}`;
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+2);
 return {today,through:end.toISOString().slice(0,10)};
}
function validDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function sourceQuery(source:ExceptionSource,page:number,now:Date){
 const stale=new Date(now.getTime()-15*60_000).toISOString(),old=new Date(now.getTime()-24*60*60_000).toISOString(),{through}=titleDateWindow(now);
 const common='id,account_id,created_at';
 const specifications:Record<ExceptionSource,{select:string;filter:string;order?:string}>={
  billing:{select:common+',state,mode,reconciled_at',filter:'mode=eq.live&state=in.(payment_failed,stop_requested)'},
  costs:{select:'operation_key,account_id,state,cost_basis,created_at',filter:`or=(and(state.in.(reserved,dispatched),created_at.lte.${old}),and(state.eq.settled,cost_basis.in.(estimated,unreconciled)))`,order:'created_at.asc,operation_key.asc'},
  texts:{select:common+',state,direction,updated_at',filter:`direction=eq.outgoing&or=(state.eq.needs_review,and(state.eq.dispatching,updated_at.lte.${stale}))`},
  emails:{select:common+',state,direction,delivery_state,updated_at',filter:`direction=eq.outgoing&or=(state.eq.needs_review,delivery_state.in.(bounced,complained,failed,delivery_delayed),and(state.eq.dispatching,updated_at.lte.${stale}))`},
  voice_jobs:{select:common+',state,updated_at',filter:`or=(state.eq.held,and(state.eq.dispatching,updated_at.lte.${stale}))`},
  call_results:{select:common+',state',filter:'state=eq.review'},
  property_checks:{select:common+',state',filter:'state=eq.failed'},
  title_tasks:{select:common+',state,kind,due_date,email_state,updated_at',filter:`or=(state.eq.needs_review,and(state.eq.scheduled,kind.eq.deadline,due_date.lte.${through}),email_state.eq.needs_review)`},
  attention_emails:{select:common+',state',filter:`or=(state.in.(needs_review,bounced,complained,failed,suppressed),and(state.eq.claimed,created_at.lte.${stale}))`},
  support:{select:common+',status,updated_at',filter:'status=eq.escalated'},
 };
 const s=specifications[source];
 return `${tables[source]}?${s.filter}&account_id=not.is.null&select=${s.select}&order=${s.order??'created_at.asc,id.asc'}&limit=${exceptionPageSize+1}&offset=${page*exceptionPageSize}`;
}
/** Server-owned fields only. Never return customer text, URLs, raw errors, recipients or provider payloads. */
export function projectException(source:ExceptionSource,raw:unknown,now:Date):ExceptionItem|null {
 const r=schemas[source].parse(raw),stale=now.getTime()-15*60_000,old=now.getTime()-24*60*60_000;
 // Cost keys can contain opaque vendor identifiers; a digest is enough to correlate a support investigation without exposing them.
 const recordId=source==='costs'?'sha256:'+createHash('sha256').update(r.operation_key).digest('hex'):r.id;
 const state=source==='support'?r.status:r.state;
 const common={key:source+':'+recordId,recordId,accountId:r.account_id,source,state,recordedAt:r.updated_at??r.created_at};
 const item=(title:string,detail:string,nextStep:string,priority:'attention'|'review'='attention'):ExceptionItem=>({...common,title,detail,nextStep,priority});
 switch(source){
  case 'billing':
   if(r.mode!=='live')return null;
   return state==='payment_failed'?item('Payment needs attention','A live daily plan is recorded as payment_failed.','Check the saved payment and renewal status before any billing change.'):
    state==='stop_requested'?item('Cancellation is not yet confirmed','A live daily plan still has a saved stop request.','Verify provider cancellation and the durable stop queue. Do not describe the plan as stopped yet.'):null;
  case 'costs':
   if(['reserved','dispatched'].includes(state)&&Date.parse(r.created_at)<=old)return item('Reservation remains held','This operation has been reserved or dispatched for at least 24 hours. Its final cost is not established here.','Reconcile the original provider outcome before releasing funds or retrying work.');
   if(state==='settled'&&r.cost_basis!=='verified')return item('Provider cost is not verified',`The settled operation has ${r.cost_basis} cost basis. A customer charge is not a supplier invoice.`, 'Match the provider evidence and existing ledger before changing any settlement.','review');
   return null;
  case 'texts':
   if(r.direction!=='outgoing')return null;
   if(state==='needs_review')return item('Text outcome needs review','The recorded outgoing text needs review. Delivery is not established by this state.','Check the original send and provider receipt. Do not resend an uncertain message.');
   return state==='dispatching'&&Date.parse(r.updated_at)<=stale?item('Text dispatch has not resolved','The outgoing text has remained dispatching for at least 15 minutes. This does not prove it failed.','Reconcile the original provider request before any resend.'):null;
  case 'emails':
   if(r.direction!=='outgoing')return null;
   if(['bounced','complained','failed','delivery_delayed'].includes(r.delivery_state))return item('Email delivery needs attention',`The recorded delivery receipt is ${r.delivery_state.replaceAll('_',' ')}. Acceptance and delivery are separate.`, 'Respect bounce/complaint suppression and inspect the original receipt before further contact.');
   return state==='needs_review'||state==='dispatching'&&Date.parse(r.updated_at)<=stale?item('Email send outcome needs review','The recorded email needs review or its dispatch has remained unresolved for at least 15 minutes.','Check the original provider request. Do not send a duplicate.'):null;
  case 'voice_jobs':
   return state==='held'?item('Call job is held','The saved call job is held. This is not evidence that a call took place.','Review the existing job and its authorization, timing and provider outcome before any release.'):
    state==='dispatching'&&Date.parse(r.updated_at)<=stale?item('Call dispatch has not resolved','The call job has remained dispatching for at least 15 minutes.','Reconcile the original provider request before another call.'):null;
  case 'call_results':return state==='review'?item('Call result needs review','The saved conversation is marked for review.','Inspect the original conversation evidence; this panel cannot redial or advance a deal.'):null;
  case 'property_checks':return state==='failed'?item('Property check needs review',`The saved property check is ${state}.`,'Review the recorded check and any original provider receipt before retrying paid work.'):null;
  case 'title_tasks': {
   if(r.email_state==='needs_review')return item('Title follow-up delivery needs review','The existing follow-up email is marked needs_review.','Check the original send receipt before further title contact.');
   if(state==='needs_review')return item('Title task needs confirmation',r.kind==='deadline'?'A date mentioned by title still needs confirmation. It is not a confirmed deadline.':'A saved title task needs review.','Review the linked deal and original title evidence. Do not change terms, deposits or wire instructions from this panel.');
   const {today,through}=titleDateWindow(now);
   if(state==='scheduled'&&r.kind==='deadline'&&validDate(r.due_date)&&r.due_date<=through)return {...item(r.due_date<today?'Recorded title deadline is overdue':'Recorded title deadline is approaching',`A confirmed title task is due ${r.due_date} (America/Chicago).`, 'Check the actual deal deadline and coordinate with the responsible party.'),dueDate:r.due_date};
   return null;
  }
  case 'attention_emails':
   if(['needs_review','bounced','complained','failed','suppressed'].includes(state)||state==='claimed'&&Date.parse(r.created_at)<=stale)return item('Customer alert delivery needs review',`The saved customer alert is ${state.replaceAll('_',' ')}. The customer may not have received it.`,'Check the receipt and notification preferences. Honor suppression and do not resend blindly.');
   return null;
  case 'support':return state==='escalated'?item('Customer asked for support','The existing support conversation is escalated.','Open the conversation in the support queue below.'):null;
 }
}

/** Read-only bounded scan. Existing support scope is platform-wide; every displayed row must bind an existing account. */
export async function collectOperatorExceptions(database:ExceptionDb,query:{source?:ExceptionSource;page:number},now=new Date(),signal?:AbortSignal):Promise<ExceptionSnapshot>{
 if(!Number.isFinite(now.getTime()))throw Error('Invalid snapshot time');
 const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000);
 const sources=query.source?[query.source]:exceptionSources;
 const sections:ExceptionSection[]=[];
 // Three simultaneous reads at most; an unavailable source is never rendered as clear.
 for(let offset=0;offset<sources.length;offset+=3){
  const batch=await Promise.all(sources.slice(offset,offset+3).map(async source=>{
   const section:ExceptionSection={source,label:exceptionLabels[source],status:'checked',items:[],hasMore:false,page:query.page};
   try{
    deadline.throwIfAborted();
    const rows=await database<unknown>(sourceQuery(source,query.page,now),'GET',undefined,deadline);
    if(!Array.isArray(rows)||rows.length>exceptionPageSize+1)throw Error('Invalid source response');
    section.hasMore=rows.length>exceptionPageSize;
    section.items=rows.slice(0,exceptionPageSize).map(row=>projectException(source,row,now)).filter((row):row is ExceptionItem=>row!==null);
   }catch{section.status='unavailable';section.items=[];section.hasMore=false;}
   return section;
  }));
  sections.push(...batch);
 }
 const accountIds=[...new Set(sections.flatMap(s=>s.items.map(item=>item.accountId)))];
 if(accountIds.length){
  try{
   deadline.throwIfAborted();
   const accounts=z.array(z.object({id})).parse(await database(`icash_accounts?id=in.(${accountIds.join(',')})&select=id&limit=${accountIds.length}`,'GET',undefined,deadline));
   const known=new Set(accounts.map(a=>a.id));
   for(const section of sections){
    if(section.items.some(item=>!known.has(item.accountId))){section.status='unavailable';section.items=section.items.filter(item=>known.has(item.accountId));}
   }
  }catch{
   // Failure to verify ownership bindings hides every item, not merely its label.
   for(const section of sections){section.items=[];section.status='unavailable';section.hasMore=false;}
  }
 }
 return {observedAt:now.toISOString(),sections,partial:sections.some(s=>s.status==='unavailable'),scope:'provisioned_support_operator',dateTimezone:'America/Chicago'};
}
