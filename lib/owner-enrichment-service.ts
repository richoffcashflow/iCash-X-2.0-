import {contactWorkEnabled} from './live-work-admission.ts';
import {db} from '@/lib/stripe-test';
import {reserveOperation} from '@/lib/operating-costs';
import {enrichOwners} from './owner-enrichment.ts';
import {runScreeningJob} from './screening-job.ts';
import {OwnerPreviewRateLimitError} from './owner-enrichment-deferral.ts';
import {enrichOwnerBatch} from './owner-batch.ts';
import {dealMachineRequest,DealMachineQuotaError} from './dealmachine-request.ts';
const future=(value:string)=>Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now();
export async function enrichForAccount(accountId:string,screeningId:string){
 if(!contactWorkEnabled())return {status:'live_work_not_ready'};
 const [c]=await db<{enabled:boolean;contacts_enabled:boolean;contact_rate_id:string;contact_credit_cap:number;property_credit_micros:number;data_rights_until:string;research_version?:number}[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
 if(!c?.enabled||!c.contacts_enabled||!c.contact_rate_id||!future(c.data_rights_until))return {status:'not_ready'};
 const jobPath=`icash_screening_jobs?id=eq.${screeningId}&account_id=eq.${accountId}&select=snapshot,state`;
 const [job]=await db<{snapshot:unknown;state:string}[]>(jobPath);
 if(job?.state!=='complete')return {status:'financial_hold'};
 // First-party inquiries already supply the phone. Never buy owner identities
 // or extra contacts for these leads, even through a direct/manual invocation.
 if(job.snapshot&&typeof job.snapshot==='object'&&'sellerRequest' in job.snapshot)return {status:'seller_contact_supplied'};
 const propertyId=(job.snapshot as {propertyId?:string})?.propertyId;
 if(!propertyId||!/^prop_\d{1,20}$/.test(propertyId))return {status:'financial_hold'};
 const controlPath=`icash_property_controls?account_id=eq.${accountId}&property_id=eq.${propertyId}&select=manual`;
 const [control]=await db<{manual:boolean}[]>(controlPath);
 if(control?.manual)return {status:'manual_control'};
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;costs_micros:{dealmachine:number}}[]>(`icash_operation_rates?id=eq.${c.contact_rate_id}&select=operation,enabled,expires_at,costs_micros`);
 if(!rate?.enabled||rate.operation!=='owner_enrichment'||!future(rate.expires_at))return {status:'rate_required'};
 const key=process.env.DEALMACHINE_API_KEY;if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 if(c.research_version===1||c.research_version===2)return enrichOwnerBatch(db,accountId,screeningId,c,rate.costs_micros.dealmachine);
 const operationKey=`owners:${accountId}:${screeningId}`;
 const frozenSnapshot=JSON.stringify(job.snapshot);
 let stage='validation',providerStatus:number|null=null;
 const request=async(url:string,init:RequestInit,error:string)=>{
  stage=init.method==='GET'?'free_preview':'paid_lookup';providerStatus=null;
  let started=false;
  try{
   const r=await dealMachineRequest(db,stage==='free_preview'?'owner_preview':'owner_lookup',()=>{started=true;return fetch(url,{...init,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});},{accountId,operationKey});
   providerStatus=r.status;
   if(!r.ok)throw new Error();return r.raw;
  }catch(cause){if(cause instanceof DealMachineQuotaError){if(stage==='free_preview')throw new OwnerPreviewRateLimitError(accountId,screeningId);throw Error('PROVIDER_RATE_LIMIT');}if(!started)throw cause;throw new Error(error);}
 };
 try{return await enrichOwners({snapshot:job.snapshot,creditCap:c.contact_credit_cap,unitCostMicros:c.property_credit_micros,quotedDataCostMicros:rate.costs_micros?.dealmachine},{
  previewOwners:id=>request(`https://api.v2.dealmachine.com/v1/properties/${id}?enrich=false&contact_audience=owners`,{method:'GET'},'OWNER_PREVIEW_FAILED_NO_RETRY'),
  reserveAndClaim:async()=>{
   stage='reservation';providerStatus=null;
   // Recheck server-owned scope after the free network request, before committing funds.
   const [current]=await db<{snapshot:unknown;state:string}[]>(jobPath);
   const [manual]=await db<{manual:boolean}[]>(controlPath);
   const [config]=await db<typeof c[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
   if(current?.state!=='complete'||JSON.stringify(current.snapshot)!==frozenSnapshot||manual?.manual||!config?.enabled||!config.contacts_enabled||config.contact_rate_id!==c.contact_rate_id||config.contact_credit_cap!==c.contact_credit_cap||config.property_credit_micros!==c.property_credit_micros||config.data_rights_until!==c.data_rights_until||!future(config.data_rights_until)||!future(rate.expires_at))return false;
   if(runScreeningJob(current.snapshot).financialCheck.status!=='eligible')return false;
   // The atomic dispatcher retains wallet/day/lifetime reservations on uncertain outcomes.
   await reserveOperation({accountId,operationKey,rateId:c.contact_rate_id,permissionUntil:c.data_rights_until,operation:'owner_enrichment',screeningId});
   const claimed=await db<boolean>('rpc/icash_claim_owner_enrichment','POST',{p_account:accountId,p_screening:screeningId,p_operation:operationKey,
    p_snapshot:job.snapshot,p_rate:c.contact_rate_id,p_credit_cap:c.contact_credit_cap,p_unit_cost_micros:c.property_credit_micros,
    p_quoted_data_cost_micros:rate.costs_micros.dealmachine,p_rights_until:c.data_rights_until});
   if(!claimed)throw new Error('Operation held or already dispatched');
   return true;
  },
  fetchPeople:ids=>request('https://api.v2.dealmachine.com/v1/people/ids',{method:'POST',body:JSON.stringify({ids,enrich:true,include_properties:false})},'OWNER_LOOKUP_FAILED_NO_RETRY'),
  recordReceipt:async receipt=>{
   stage='receipt';
   for(const field of ['used','people','properties','deduplicated'] as const){
    await db('rpc/icash_record_cost_observation','POST',{p_provider:'dealmachine',p_event:field==='used'?operationKey:`${operationKey}:${field}`,
     p_source:`dealmachine:owners:${operationKey}${field==='used'?'':`:${field}`}`,p_amount:receipt[field],p_units:'provider_credits'});
   }
  },
  persist:async result=>{stage='persist';await db('rpc/icash_save_contacts','POST',{p_account:accountId,p_screening:screeningId,p_operation:operationKey,p_result:result});await db('rpc/icash_settle_dealmachine_usage','POST',{p_operation:operationKey});},
 });}catch(error){
  const allowed=['CONTACT_RATE_REQUIRED','CONTACT_PREVIEW_INVALID','OWNER_PREVIEW_FAILED_NO_RETRY','OWNER_PREVIEW_RATE_LIMITED','PROVIDER_RATE_LIMIT','CONTACT_RECEIPT_REQUIRES_RECONCILIATION','OWNER_LOOKUP_FAILED_NO_RETRY','Prospecting budget reached','INVALID_SNAPSHOT','PROPERTY_RESPONSE_INVALID'];
  const code=error instanceof Error&&allowed.includes(error.message)?error.message:'unclassified';
  // Never log credentials, identities, property IDs, URLs or provider bodies.
  console.warn('owner_enrichment_held',{stage,code,httpStatus:providerStatus});
  throw error;
 }
}
