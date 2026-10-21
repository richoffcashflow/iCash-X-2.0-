import {z} from 'zod';
import {workspaceActivity} from '@/lib/workspace-activity-read';
import {currentBotActivity} from '@/lib/bot-activity';
import {validActivityReport,type ActivityDays} from '@/lib/activity-report';
import {dealMachinePhoto} from '@/lib/property-photo';
import {db} from '@/lib/stripe-test';
import {ownerAccountView,ownerViewFailure,ownerViewHeaders,OwnerViewError} from '@/lib/owner-account-access';
import {ownerLeadsSchema} from '@/lib/owner-accounts';
import {propertyCallHistory} from '@/lib/property-call-history';
import {recordingPresentation,recordingPresentationById} from '@/lib/required-call-recording-receipt';
import {recordingServer} from '@/lib/required-call-recording-server';
import {recordedReceptionServer} from '@/lib/recorded-reception-server';
import {recordedReceptionPresentation} from '@/lib/recorded-reception-presentation';
import type {RecordedReceptionRow} from '@/lib/recorded-reception';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=30;
const id=z.string().uuid(),page=z.string().regex(/^\d{1,5}$/).transform(Number).refine(n=>n<=10000);
const resources=new Set(['activity','report','progress','bot-status','property-photo','leads','details','messages','call-history','conversation','recording','recording/audio','reception-recording','reception-recording/audio']);
const json=(data:unknown)=>Response.json(data,{headers:ownerViewHeaders});
// Deliberately explicit, read-only resources. Never forward arbitrary paths,
// impersonate Auth users, or call the provisioning/work-starting account loader.
export async function GET(req:Request,context:{params:Promise<{viewId:string;resource:string[]}>}){try{
 const p=await context.params,resource=p.resource.join('/');
 if(!resources.has(resource))return new Response(null,{status:404,headers:ownerViewHeaders});
 const {actor,view}=await ownerAccountView(id.parse(p.viewId)),accountId=view.account.id;
 const params=new URL(req.url).searchParams,query=Object.fromEntries(params);
 if([...params.keys()].some(k=>params.getAll(k).length!==1))throw new OwnerViewError(400,'Invalid account view request.');
 if(resource==='activity'){
  z.object({view:z.enum(['opportunities','responses','all']).optional(),page:page.optional(),attentionPage:page.optional(),query:z.string().max(100).optional(),screeningId:id.optional()}).strict().parse(query);
  // Same customer data loader, with outcome refresh and all work mutations off.
  const result=await workspaceActivity(req,accountId);
  for(const [key,value] of Object.entries(ownerViewHeaders))result.headers.set(key,value);
  return result;
 }
 if(resource==='progress'||resource==='bot-status'){
  z.object({}).strict().parse(query);
  const progress=await db<{status?:string;callsBudgetHeld?:number}|null>('rpc/icash_prospecting_progress','POST',{p_account:accountId});
  if(resource==='progress')return json({progress});
  const [tickets,screening]=await Promise.all([
   db<{kind:string;state:string;expires_at:string}[]>(`icash_automation_tickets?account_id=eq.${accountId}&state=eq.consumed&expires_at=gt.${new Date().toISOString()}&select=kind,state,expires_at&order=created_at.desc&limit=10`),
   db<{state:string;lease_until:string|null}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.running&select=state,lease_until&limit=10`)
  ]);
  return json(currentBotActivity({paused:view.account.paused,tickets,screening,progress}));
 }
 if(resource==='report'){
  const f=z.object({days:z.enum(['1','7','30']).default('1'),timezone:z.string().max(100).default('UTC')}).strict().parse(query);
  try{new Intl.DateTimeFormat('en-US',{timeZone:f.timezone});}catch{throw new OwnerViewError(400,'Invalid timezone.');}
  const days=Number(f.days) as ActivityDays;
  const [report,savings]=await Promise.all([db<unknown>('rpc/icash_activity_report','POST',{p_account:accountId,p_days:days,p_timezone:f.timezone}),db<unknown>('rpc/icash_vip_savings','POST',{p_account:accountId}).catch(()=>null)]);
  if(!validActivityReport(report,days))throw Error('Activity unavailable');
  return json({...report,vipSavingsCents:typeof savings==='number'&&Number.isSafeInteger(savings)&&savings>=0?savings:null});
 }
 if(resource==='property-photo'){
  const f=z.object({screeningId:id}).strict().parse(query);
  const [row]=await db<{snapshot?:{raw?:{data?:{dm_property_id?:string;images?:unknown}}};result:{property:{propertyId:string;images?:unknown}}}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${f.screeningId}&state=eq.complete&select=snapshot,result&limit=1`);
  if(!row)throw new OwnerViewError(404,'This property is not in the viewed account.');
  const property=row.result.property,raw=row.snapshot?.raw?.data;
  // Inspection uses saved images only; never buys a provider lookup or takes a cache lease.
  return json({photo:dealMachinePhoto(property.images)??(raw?.dm_property_id===property.propertyId?dealMachinePhoto(raw.images):null)});
 }
 if(resource==='leads'){
  const f=z.object({q:z.string().trim().max(100).default(''),page:page.default('1').refine(n=>n>=1)}).strict().parse(query);
  return json(ownerLeadsSchema.parse(await db('rpc/icash_owner_account_leads','POST',{p_actor:actor.userId,p_account:accountId,p_query:f.q,p_page:f.page},req.signal)));
 }
 if(resource==='call-history'){
  const f=z.object({screeningId:id,page:page.default('0')}).strict().parse(query);
  const history=await propertyCallHistory(db,accountId,f.screeningId,f.page);
  if(!history)throw new OwnerViewError(404,'This property is not in the viewed account.');
  return json(history);
 }
 if(resource==='details'||resource==='messages'){
  const f=z.object({screeningId:id,threadId:id.optional(),afterThread:id.optional(),before:z.string().datetime({offset:true}).optional(),beforeId:id.optional()}).strict().parse(query);
  const [screen]=await db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${f.screeningId}&select=id&limit=1`);
  if(!screen)throw new OwnerViewError(404,'This property is not in the viewed account.');
  if(resource==='details'){
   const [conversations,incoming,contacts]=await Promise.all([
    db(`icash_live_conversations?account_id=eq.${accountId}&screening_id=eq.${screen.id}&state=eq.complete&select=id,party,completed_at,summary:result->>summary,durationSeconds:result->durationSeconds,nextAction:result->>nextAction,interested:result->interested,optedOut:result->optedOut,humanRequested:result->humanRequested&order=completed_at.desc,id.desc&limit=20`),
    db<unknown[]>('rpc/icash_buyer_reception_calls','POST',{p_account:accountId,p_screenings:[screen.id]}),
    db<{people:unknown}[]>(`icash_owner_contacts?account_id=eq.${accountId}&screening_id=eq.${screen.id}&select=people:result->contacts&limit=1`)
   ]);
   // Only display saved contact fields, never raw provider data or permissions.
   const people=z.array(z.object({name:z.string().nullable().optional(),phones:z.array(z.object({number:z.string().nullable().optional(),type:z.string().nullable().optional()})).optional()})).safeParse(contacts[0]?.people??[]);
   return json({conversations:[...(Array.isArray(conversations)?conversations:[]),...incoming],contacts:people.success?people.data:[]});
  }
  const [deal]=await db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screen.id}&select=id&order=created_at.desc,id&limit=1`);
  if(!deal)return json({threads:[],messages:[],threadId:null,next:null,nextThread:null});
  const rows=await db<{id:string;recipient:string;party:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${deal.id}&retired_at=is.null&select=id,recipient,party&order=id.desc&limit=21${f.afterThread?`&id=lt.${f.afterThread}`:''}`);
  const threads=rows.slice(0,20),threadId=f.threadId??threads[0]?.id;
  if(threadId&&!threads.some(t=>t.id===threadId))throw new OwnerViewError(404,'Conversation unavailable in this account.');
  if(!!f.before!==!!f.beforeId)throw new OwnerViewError(400,'Invalid message page.');
  const messages=threadId?await db<{id:string;direction:string;body:string;state:string;created_at:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&select=id,direction,body,state,created_at&order=created_at.desc,id.desc&limit=21${f.before?`&or=(created_at.lt.${encodeURIComponent(f.before)},and(created_at.eq.${encodeURIComponent(f.before)},id.lt.${f.beforeId}))`:''}`):[];
  const visible=messages.slice(0,20),last=visible.at(-1);
  return json({threads,threadId:threadId??null,messages:visible,next:messages.length>20&&last?{before:last.created_at,beforeId:last.id}:null,nextThread:rows.length>20?threads.at(-1)!.id:null});
 }
 if(resource==='conversation'){
  const f=z.object({id,source:z.enum(['outbound','reception']).default('outbound'),before:page.optional()}).strict().parse(query);
  if(f.source==='reception'){
   const call=await db('rpc/icash_reception_conversation','POST',{p_account:accountId,p_session:f.id,p_before:f.before??null});
   if(!call)throw new OwnerViewError(404,'Conversation unavailable in this account.');return json(call);
  }
  const [call]=await db<{party:string;result:{summary?:string;transcript?:{role:string;message:string}[]}}[]>(`icash_live_conversations?account_id=eq.${accountId}&id=eq.${f.id}&state=eq.complete&select=party,result&limit=1`);
  if(!call)throw new OwnerViewError(404,'Conversation unavailable in this account.');
  const turns=call.result.transcript??[],end=Math.min(f.before??turns.length,turns.length),start=Math.max(0,end-60);
  return json({party:call.party,summary:call.result.summary,transcript:turns.slice(start,end),next:start>0?start:null});
 }
 if(resource==='recording'){
  const f=z.object({id:id.optional(),conversationId:id.optional()}).strict().refine(v=>!!v.id!==!!v.conversationId).parse(query);
  const result=f.id?await recordingPresentationById(db,accountId,f.id):await recordingPresentation(db,accountId,f.conversationId!);
  if(!result)throw new OwnerViewError(404,'Recording unavailable in this account.');return json(result);
 }
 const f=z.object({id}).strict().parse(query);
 if(resource==='reception-recording'){
  const row=await db<RecordedReceptionRow|null>('rpc/icash_get_recorded_reception_session','POST',{p_id:f.id,p_account:accountId,p_operation:null});
  if(!row||row.account_id!==accountId)throw new OwnerViewError(404,'Recording unavailable in this account.');
  return json(recordedReceptionPresentation(row));
 }
 const response=await (resource==='recording/audio'?recordingServer(req.signal):recordedReceptionServer(req.signal)).audio(accountId,f.id,req.headers.get('range'));
 for(const [key,value] of Object.entries(ownerViewHeaders))response.headers.set(key,value);
 return response;
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'Invalid account view request.'},{status:400,headers:ownerViewHeaders});return ownerViewFailure(e);}}
