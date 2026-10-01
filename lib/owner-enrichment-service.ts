import {db} from '@/lib/stripe-test';
import {reserveOperation} from '@/lib/operating-costs';
import {enrichOwners} from './owner-enrichment.ts';
import {runScreeningJob} from './screening-job.ts';
const future=(value:string)=>Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now();
export async function enrichForAccount(accountId:string,screeningId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready'};
 const [c]=await db<{enabled:boolean;contacts_enabled:boolean;contact_rate_id:string;contact_credit_cap:number;property_credit_micros:number;data_rights_until:string}[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
 if(!c?.enabled||!c.contacts_enabled||!c.contact_rate_id||!future(c.data_rights_until))return {status:'not_ready'};
 const jobPath=`icash_screening_jobs?id=eq.${screeningId}&account_id=eq.${accountId}&select=snapshot,state`;
 const [job]=await db<{snapshot:unknown;state:string}[]>(jobPath);
 if(job?.state!=='complete')return {status:'financial_hold'};
 const propertyId=(job.snapshot as {propertyId?:string})?.propertyId;
 if(!propertyId||!/^prop_\d{1,20}$/.test(propertyId))return {status:'financial_hold'};
 const controlPath=`icash_property_controls?account_id=eq.${accountId}&property_id=eq.${propertyId}&select=manual`;
 const [control]=await db<{manual:boolean}[]>(controlPath);
 if(control?.manual)return {status:'manual_control'};
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;costs_micros:{dealmachine:number}}[]>(`icash_operation_rates?id=eq.${c.contact_rate_id}&select=operation,enabled,expires_at,costs_micros`);
 if(!rate?.enabled||rate.operation!=='owner_enrichment'||!future(rate.expires_at))return {status:'rate_required'};
 const key=process.env.DEALMACHINE_API_KEY;if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 const operationKey=`owners:${accountId}:${screeningId}`;
 const frozenSnapshot=JSON.stringify(job.snapshot);
 const request=async(url:string,init:RequestInit,error:string)=>{
  if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw new Error('PROVIDER_RATE_LIMIT');
  try{
   const r=await fetch(url,{...init,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new Error();return await r.json();
  }catch{throw new Error(error);}
 };
 return enrichOwners({snapshot:job.snapshot,creditCap:c.contact_credit_cap,unitCostMicros:c.property_credit_micros,quotedDataCostMicros:rate.costs_micros?.dealmachine},{
  previewOwners:id=>request(`https://api.v2.dealmachine.com/v1/properties/${id}?enrich=false&contact_audience=owners`,{method:'GET'},'OWNER_PREVIEW_FAILED_NO_RETRY'),
  reserveAndClaim:async()=>{
   // Recheck server-owned scope after the free network request, before committing funds.
   const [current]=await db<{snapshot:unknown;state:string}[]>(jobPath);
   const [manual]=await db<{manual:boolean}[]>(controlPath);
   const [config]=await db<typeof c[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
   if(current?.state!=='complete'||JSON.stringify(current.snapshot)!==frozenSnapshot||manual?.manual||!config?.enabled||!config.contacts_enabled||config.contact_rate_id!==c.contact_rate_id||config.contact_credit_cap!==c.contact_credit_cap||config.property_credit_micros!==c.property_credit_micros||config.data_rights_until!==c.data_rights_until||!future(config.data_rights_until)||!future(rate.expires_at))return false;
   if(runScreeningJob(current.snapshot).financialCheck.status!=='eligible')return false;
   // The atomic dispatcher retains wallet/day/lifetime reservations on uncertain outcomes.
   await reserveOperation({accountId,operationKey,rateId:c.contact_rate_id,permissionUntil:c.data_rights_until});
   const claimed=await db<boolean>('rpc/icash_claim_owner_enrichment','POST',{p_account:accountId,p_screening:screeningId,p_operation:operationKey,
    p_snapshot:job.snapshot,p_rate:c.contact_rate_id,p_credit_cap:c.contact_credit_cap,p_unit_cost_micros:c.property_credit_micros,
    p_quoted_data_cost_micros:rate.costs_micros.dealmachine,p_rights_until:c.data_rights_until});
   if(!claimed)throw new Error('Operation held or already dispatched');
   return true;
  },
  fetchPeople:ids=>request('https://api.v2.dealmachine.com/v1/people/ids',{method:'POST',body:JSON.stringify({ids,enrich:true,include_properties:false})},'OWNER_LOOKUP_FAILED_NO_RETRY'),
  recordReceipt:async receipt=>{
   for(const field of ['used','people','properties','deduplicated'] as const){
    await db('rpc/icash_record_cost_observation','POST',{p_provider:'dealmachine',p_event:field==='used'?operationKey:`${operationKey}:${field}`,
     p_source:`dealmachine:owners:${operationKey}${field==='used'?'':`:${field}`}`,p_amount:receipt[field],p_units:'provider_credits'});
   }
  },
  persist:async result=>{await db('rpc/icash_save_contacts','POST',{p_account:accountId,p_screening:screeningId,p_operation:operationKey,p_result:result});},
 });
}
