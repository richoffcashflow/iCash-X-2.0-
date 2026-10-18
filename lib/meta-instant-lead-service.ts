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
export async function getInstantLead(db:SellerDb,id:string){
 const [lead]=await db<InstantLead[]>(`icash_meta_leads?lead_id=eq.${encodeURIComponent(id)}&select=lead_id,account_id,screening_id,meta_id,submitted_at,link_hash,link_expires_at,paused,declined_at,offer_ready_at,lead:icash_seller_intakes!lead_id(name,phone,address,state)&limit=1`);
 return lead??null;
}
export async function queueInstantAddressLink(d:Deps,lead:InstantLead,purpose:'initial'|'address_link'|'reply',key:string,reply?:string){
 if(!instantLeadsEnabled(d.env)||!d.env.META_LEAD_LINK_SECRET||!lead.account_id||!lead.screening_id||lead.paused||lead.declined_at)return {status:'held'};
 const token=instantLeadToken(lead.meta_id,lead.submitted_at,d.env.META_LEAD_LINK_SECRET);
 if(hashLeadToken(token)!==lead.link_hash||Date.parse(lead.link_expires_at)<=Date.now())return {status:'link_expired'};
 const [identity]=await d.db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${lead.account_id}&select=principal`);
 if(!identity?.principal)return {status:'principal_required'};
 const intro=reply??'HomeOffer Network: Confirm the full address here: ';
 const suffix=' STOP to opt out.';
 let body=purpose==='initial'?instantLeadInitialText(lead.lead.name):intro+instantAddressLink(token)+suffix;
 if(!smsLength(body).fits)body='HomeOffer Network AI: Enter the full address: '+instantAddressLink(token)+suffix;
 if(!smsLength(body).fits)return {status:'message_format_required'};
 const id=await d.db<string|null>('rpc/icash_meta_queue_message','POST',{p_lead:lead.lead_id,p_purpose:purpose,p_key:key,p_body:body});
 return id?d.sms(lead.account_id,id):{status:'message_held'};
}
export async function processInstantLead(d:Deps,id:string){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 const assigned=await d.db<{status:string}>('rpc/icash_meta_assign_contact','POST',{p_lead:id});
 if(assigned.status!=='assigned')return {status:assigned.status};
 const lead=await getInstantLead(d.db,id);if(!lead?.account_id||!lead.screening_id||lead.paused||lead.declined_at)return {status:'held'};
 const completion=await d.db<boolean>('rpc/icash_meta_match_address_request','POST',{p_lead:id});
 if(completion)await queueInstantAddressLink(d,lead,'address_link','completion');
 // Independent channels; a lookup or SMS outage must not block a valid call.
 const tasks=await Promise.allSettled([
  queueInstantAddressLink(d,lead,'initial','initial'),
  (async()=>{const call=await d.db<{accountId:string;voiceJobId:string}|null>('rpc/icash_meta_prepare_voice','POST',{p_lead:id});return call?d.voice(call.accountId,call.voiceJobId):{status:'call_pending_or_already_started'};})(),
 ]);
 return {status:'processed',sms:tasks[0].status==='fulfilled'?tasks[0].value.status:'pending',voice:tasks[1].status==='fulfilled'?tasks[1].value.status:'pending'};
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
  if(!response.ok)throw Error('META_RETRIEVAL_PENDING');
  const raw=await response.text();if(raw.length>64000)throw Error('META_RECEIPT_TOO_LARGE');
  stage='validate';const lead=parseMetaLead(JSON.parse(raw),claim.notice,source);
  const token=instantLeadToken(lead.metaId,lead.submittedAt,d.env.META_LEAD_LINK_SECRET);
  stage='save';
  const saved=await d.db<{leadId:string;accountId:string|null;duplicate:boolean}>('rpc/icash_meta_accept_lead','POST',{p_source:source.id,p_payload:lead,p_link_hash:hashLeadToken(token)});
  await d.db(`icash_meta_lead_inbox?meta_id=eq.${claim.metaId}&claim_token=eq.${claim.token}`,'PATCH',{state:'accepted',lead_id:saved.leadId,reason:null});
  await processInstantLead(d,saved.leadId);
  return {status:'accepted'};
 }catch(error){
  const reason=error instanceof Error&&/^[A-Z_]{5,70}$/.test(error.message)?error.message:'META_RECEIPT_REVIEW_REQUIRED';
  await d.db(`icash_meta_lead_inbox?meta_id=eq.${claim.metaId}&claim_token=eq.${claim.token}`,'PATCH',{state:stage==='validate'?'review':'pending',reason,next_attempt_at:new Date(Date.now()+120000).toISOString()});
  return {status:stage==='validate'?'review':'retry_pending'};
 }
}
export async function researchInstantAddress(d:Deps,id:string,options?:{liveCall?:boolean}){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 const lead=await getInstantLead(d.db,id);if(!lead?.account_id||!lead.screening_id||lead.paused||lead.declined_at)return {status:'unavailable'};
 // The database claim serializes voice, SMS, form and worker races. A timeout
 // stays in review and cannot purchase another lookup automatically.
 const lookup=await processSellerIntake(<T>(path:string,method?:string,body?:unknown)=>d.db<T>(path==='rpc/icash_claim_seller_lookup_for'?'rpc/icash_meta_claim_lookup':path,method,body),d.env.DEALMACHINE_API_KEY,d.fetch??fetch,id,options?.liveCall?8000:15000);
 const promoted=await d.db<{status:string;offerReady?:boolean}>('rpc/icash_meta_promote_property','POST',{p_lead:id});
 return promoted.status==='property_ready'?promoted:lookup;
}
export async function processInstantLeadWork(d:Deps){
 if(!instantLeadsEnabled(d.env))return {status:'disabled'};
 const measurement=Promise.allSettled(Array.from({length:3},()=>deliverInstantCrmEvent(d.db,d.env,d.fetch??fetch)));
 const intake=await retrieveInstantLead(d);
 try{await processMakeLead({db:d.db,env:d.env,onAccepted:id=>processInstantLead(d,id)});}catch{console.warn('make_lead_worker_pending');}
 const due=await d.db<{lead_id:string}[]>('icash_meta_leads?paused=eq.false&declined_at=is.null&contact_until=gt.'+encodeURIComponent(new Date().toISOString())+'&next_attempt_at=lte.'+encodeURIComponent(new Date().toISOString())+'&select=lead_id&order=next_attempt_at&limit=3');
 for(const row of due){
  await d.db(`icash_meta_leads?lead_id=eq.${row.lead_id}`,'PATCH',{next_attempt_at:new Date(Date.now()+60000).toISOString()});
  const lead=await getInstantLead(d.db,row.lead_id);if(!lead)continue;
  if(['received','qualified','numbers_review'].includes(lead.lead.state))await researchInstantAddress(d,lead.lead_id);
  await processInstantLead(d,row.lead_id);
  const call=await d.db<{accountId:string;voiceJobId:string}|null>('rpc/icash_meta_offer_followup','POST',{p_lead:row.lead_id});
  if(call)await d.voice(call.accountId,call.voiceJobId);
  if(lead.lead.state==='assigned')await d.db(`icash_meta_leads?lead_id=eq.${row.lead_id}`,'PATCH',{next_attempt_at:new Date(Date.now()+15*60000).toISOString()});
 }
 await measurement;
 return {status:'processed',intake:intake.status};
}
