import {deliverInstantCrmEvent} from './meta-instant-events.ts';
import {smsLength} from './sms-length.ts';
import {createHmac} from 'node:crypto';
import {hashLeadToken,instantLeadToken,instantAddressLink,instantLeadInitialText,parseMetaLead,metaLeadAccessToken,type MetaLeadSource,type MetaLeadNotice} from './meta-instant-leads.ts';
import {processSellerIntake,type SellerDb} from './seller-pipeline.ts';
import {processMakeLead} from './meta-make-intake.ts';
type Dispatch=(account:string,id:string)=>Promise<{status:string}>;
type Deps={db:SellerDb;sms:Dispatch;voice:Dispatch;env:NodeJS.ProcessEnv;fetch?:typeof fetch};
export type InstantLead={lead_id:string;account_id:string|null;screening_id:string|null;meta_id:string;submitted_at:string;link_hash:string;link_expires_at:string;paused:boolean;declined_at:string|null;offer_ready_at:string|null;lead:{name:string|null;phone:string;address:string|null;state:string};};
export const instantLeadsEnabled=(env:NodeJS.ProcessEnv)=>env.META_INSTANT_LEADS_ENABLED==='true'&&(!env.VERCEL_ENV||env.VERCEL_ENV==='production');
async function readLeadReceipt(response:Response){
 const limit=64000,length=response.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>limit)){await response.body?.cancel().catch(()=>undefined);throw Error('META_RECEIPT_TOO_LARGE');}
 if(!response.body)throw Error('META_RETRIEVAL_PENDING');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit)throw Error('META_RECEIPT_TOO_LARGE');chunks.push(chunk.value);}}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
export async function getInstantLead(db:SellerDb,id:string){
 const [lead]=await db<InstantLead[]>(`icash_meta_leads?lead_id=eq.${encodeURIComponent(id)}&select=lead_id,account_id,screening_id,meta_id,submitted_at,link_hash,link_expires_at,paused,declined_at,offer_ready_at,lead:icash_seller_intakes!lead_id(name,phone,address,state)&limit=1`);
 return lead??null;
}
export async function queueInstantAddressLink(d:Deps,lead:InstantLead,purpose:'initial'|'address_link'|'reply',key:string,reply?:string){
 if(!instantLeadsEnabled(d.env)||!d.env.META_LEAD_LINK_SECRET||!lead.account_id||!lead.screening_id||lead.paused||lead.declined_at)return {status:'held'};
 const token=instantLeadToken(lead.meta_id,lead.submitted_at,d.env.META_LEAD_LINK_SECRET);
 if(hashLeadToken(token)!==lead.link_hash||!(Date.parse(lead.link_expires_at)>Date.now()))return {status:'link_expired'};
 const [identity]=await d.db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${lead.account_id}&select=principal`);
 if(!identity?.principal)return {status:'principal_required'};
 const intro=reply??'HomeOffer Network: Confirm the full address here: ';
 let body=purpose==='initial'?instantLeadInitialText(lead.lead.name):intro+instantAddressLink(token);
 if(!smsLength(body).fits)body='HomeOffer Network AI: Enter the full address: '+instantAddressLink(token);
 if(!smsLength(body).fits)return {status:'message_format_required'};
 const id=await d.db<string|null>('rpc/icash_meta_queue_message','POST',{p_lead:lead.lead_id,p_purpose:purpose,p_key:key,p_body:body});
 if(!id)return {status:'message_held'};
 const receipt=async()=>{
  const [message]=await d.db<{state:string;provider_id:string|null}[]>(`icash_text_messages?id=eq.${encodeURIComponent(id)}&account_id=eq.${lead.account_id}&direction=eq.outgoing&select=state,provider_id&limit=1`);
  return message;
 };
 const accepted=(message:Awaited<ReturnType<typeof receipt>>)=>!!message?.provider_id&&['accepted','delivered'].includes(message.state);
 // The queue returns the same message on replay. A saved provider receipt is
 // success even though dispatch correctly refuses to send that message again.
 const message=await receipt();
 if(accepted(message))return {status:'message_accepted'};
 if(message?.state!=='ready')return {status:'message_held'};
 const result=await d.sms(lead.account_id,id);
 return result.status==='message_held'&&accepted(await receipt())?{status:'message_accepted'}:result;
}
export async function processInstantLead(d:Deps,id:string){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 const assigned=await d.db<{status:string}>('rpc/icash_meta_assign_contact','POST',{p_lead:id});
 if(assigned.status!=='assigned')return {status:assigned.status};
 const lead=await getInstantLead(d.db,id);if(!lead?.account_id||!lead.screening_id||lead.paused||lead.declined_at)return {status:'held'};
 // Address-link completion has its own durable source and must not gate either
 // initial channel. Every branch still uses its existing one-use final claim.
 const tasks=await Promise.allSettled([
  queueInstantAddressLink(d,lead,'initial','initial'),
  (async()=>{const call=await d.db<{accountId:string;voiceJobId:string}|null>('rpc/icash_meta_prepare_voice','POST',{p_lead:id});return call?d.voice(call.accountId,call.voiceJobId):{status:'call_pending_or_already_started'};})(),
  (async()=>{const completion=await d.db<boolean>('rpc/icash_meta_match_address_request','POST',{p_lead:id});return completion?queueInstantAddressLink(d,lead,'address_link','completion'):{status:'idle'};})(),
 ]);
 const failures=tasks.filter(task=>task.status==='rejected').length;
 return {status:failures?'pending':'processed',sms:tasks[0].status==='fulfilled'?tasks[0].value.status:'pending',voice:tasks[1].status==='fulfilled'?tasks[1].value.status:'pending',failures};
}
export async function retrieveInstantLead(d:Deps){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 if(!d.env.META_LEAD_LINK_SECRET||!/^v\d{1,3}\.0$/.test(d.env.META_GRAPH_VERSION??''))return {status:'meta_configuration_required'};
 const claim=await d.db<{metaId:string;sourceId:string;notice:MetaLeadNotice;token:string}|null>('rpc/icash_meta_claim_notice','POST',{});
 if(!claim)return {status:'idle'};
 let stage='fetch';
 try{
  const [source]=await d.db<MetaLeadSource[]>(`icash_meta_lead_sources?id=eq.${claim.sourceId}&select=*`);
  if(!source?.enabled)throw Error('META_SOURCE_DISABLED');
  const pageToken=metaLeadAccessToken(source.page_id,d.env);
  const url=new URL(`https://graph.facebook.com/${d.env.META_GRAPH_VERSION}/${claim.metaId}`);
  url.searchParams.set('fields','id,form_id,ad_id,adset_id,campaign_id,created_time,field_data,custom_disclaimer_responses');
  if(d.env.META_LEAD_APP_SECRET)url.searchParams.set('appsecret_proof',createHmac('sha256',d.env.META_LEAD_APP_SECRET).update(pageToken).digest('hex'));
  const response=await (d.fetch??fetch)(url,{headers:{Authorization:'Bearer '+pageToken},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw Error('META_RETRIEVAL_PENDING');}
  const raw=await readLeadReceipt(response);
  stage='validate';const lead=parseMetaLead(JSON.parse(raw),claim.notice,source);
  const token=instantLeadToken(lead.metaId,lead.submittedAt,d.env.META_LEAD_LINK_SECRET);
  stage='save';
  const saved=await d.db<{leadId:string;accountId:string|null;duplicate:boolean}>('rpc/icash_meta_accept_lead','POST',{p_source:source.id,p_payload:lead,p_link_hash:hashLeadToken(token)});
  await d.db(`icash_meta_lead_inbox?meta_id=eq.${claim.metaId}&claim_token=eq.${claim.token}`,'PATCH',{state:'accepted',lead_id:saved.leadId,reason:null});
  // Intake is durable. A downstream failure must never put this accepted
  // provider notice back into retrieval or replay its original contact claims.
  try{const work=await processInstantLead(d,saved.leadId);return {status:'accepted',work:work.status};}
  catch{console.warn('meta_accepted_lead_work_pending');return {status:'accepted',work:'pending'};}
 }catch(error){
  const reason=error instanceof Error&&/^[A-Z_]{5,70}$/.test(error.message)?error.message:'META_RECEIPT_REVIEW_REQUIRED';
  await d.db(`icash_meta_lead_inbox?meta_id=eq.${claim.metaId}&claim_token=eq.${claim.token}&state=neq.accepted`,'PATCH',{state:stage==='validate'?'review':'pending',reason,next_attempt_at:new Date(Date.now()+120000).toISOString()});
  return {status:stage==='validate'?'review':'retry_pending'};
 }
}
export async function researchInstantAddress(d:Deps,id:string,options?:{liveCall?:boolean}){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 const lead=await getInstantLead(d.db,id);if(!lead?.account_id||!lead.screening_id||lead.paused||lead.declined_at)return {status:'unavailable'};
 // The database claim serializes voice, SMS, form and worker races. A timeout
 // stays in review and cannot purchase another lookup automatically.
 const lookup=await processSellerIntake(<T>(path:string,method?:string,body?:unknown)=>d.db<T>(path==='rpc/icash_claim_seller_lookup_admitted_for'?'rpc/icash_meta_claim_lookup_admitted':path,method,body),d.env.DEALMACHINE_API_KEY,d.fetch??fetch,id,options?.liveCall?8000:15000);
 const promoted=await d.db<{status:string;offerReady?:boolean}>('rpc/icash_meta_promote_property','POST',{p_lead:id});
 return promoted.status==='property_ready'?promoted:lookup;
}
export async function processInstantFollowups(d:Deps,id:string){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 const work=await d.db<{accountId:string;messageIds:string[];voiceJobId:string|null}|null>('rpc/icash_meta_prepare_followups','POST',{p_lead:id});
 if(!work?.accountId)return {status:'idle'};
 // Database receipts cap each step; final channel claims recheck for replies.
 // One provider outage must not prevent the other channel from progressing.
 const results=await Promise.allSettled([
  ...work.messageIds.map(message=>d.sms(work.accountId,message)),
  ...(work.voiceJobId?[d.voice(work.accountId,work.voiceJobId)]:[]),
 ]);
 const completed=new Set(['message_accepted','message_delivered','call_started']);
 return {status:results.some(result=>result.status==='rejected'||!completed.has(result.value.status))?'pending':'processed',failures:results.filter(result=>result.status==='rejected').length};
}
export async function processInstantLeadWork(d:Deps){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 let failures=0;
 const run=async<T>(stage:string,work:()=>Promise<T>):Promise<T|undefined>=>{
  try{return await work();}catch{failures++;console.warn('meta_lead_step_pending',{stage});return undefined;}
 };
 const measurement=Promise.all(Array.from({length:3},()=>run('measurement',()=>deliverInstantCrmEvent(d.db,d.env,d.fetch??fetch))));
 const [intake,make]=await Promise.all([
  run('intake',()=>retrieveInstantLead(d)),
  run('make',()=>processMakeLead({db:d.db,env:d.env,onAccepted:id=>processInstantLead(d,id)})),
 ]);
 for(const result of [intake,make])if(result?.status==='retry_pending'||result&&'work' in result&&result.work==='pending')failures++;
 const due=await run('selection',()=>d.db<{lead_id:string}[]>('icash_meta_leads?paused=eq.false&declined_at=is.null&contact_until=gt.'+encodeURIComponent(new Date().toISOString())+'&next_attempt_at=lte.'+encodeURIComponent(new Date().toISOString())+'&select=lead_id&order=next_attempt_at&limit=3'));
 for(const row of (due??[]).slice(0,3)){
  // A failed scheduling checkpoint stops only this row. No failed stage is
  // repeated within the pass; later accounts retain their independent claims.
  let selected=false;
  await run('checkpoint',async()=>{await d.db(`icash_meta_leads?lead_id=eq.${row.lead_id}`,'PATCH',{next_attempt_at:new Date(Date.now()+60000).toISOString()});selected=true;});
  if(!selected)continue;
  const lead=await run('lead',()=>getInstantLead(d.db,row.lead_id));if(!lead)continue;
  const before=failures;
  const [,initial]=await Promise.all([
   ['received','qualified','numbers_review'].includes(lead.lead.state)?run('research',()=>researchInstantAddress(d,lead.lead_id)):Promise.resolve(),
   run('initial',()=>processInstantLead(d,row.lead_id)),
  ]);
  if(initial&&'failures' in initial)failures+=initial.failures??0;
  const followup=await run('followup',()=>processInstantFollowups(d,row.lead_id));
  if(followup&&'failures' in followup)failures+=followup.failures??0;
  await run('offer',async()=>{
   const call=await d.db<{accountId:string;voiceJobId:string}|null>('rpc/icash_meta_offer_followup','POST',{p_lead:row.lead_id});
   if(call)await d.voice(call.accountId,call.voiceJobId);
  });
  // Fast retry cadence remains in place after an independent stage failed.
  if(lead.lead.state==='assigned'&&initial?.status==='processed'&&failures===before)await run('checkpoint',()=>d.db(`icash_meta_leads?lead_id=eq.${row.lead_id}`,'PATCH',{next_attempt_at:new Date(Date.now()+15*60000).toISOString()}));
 }
 await measurement;
 return {status:failures?'pending':'processed',intake:intake?.status??'pending',failures};
}
