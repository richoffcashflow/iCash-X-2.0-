import {db} from '@/lib/stripe-test';
import {dispatchReservedOperation} from '@/lib/operating-costs';
import {enrichOwners} from './owner-enrichment.ts';
export async function enrichForAccount(accountId:string,screeningId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready'};
 const [c]=await db<{enabled:boolean;contacts_enabled:boolean;contact_rate_id:string;contact_credit_cap:number;property_credit_micros:number;data_rights_until:string}[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
 if(!c?.enabled||!c.contacts_enabled||!c.contact_rate_id||Date.parse(c.data_rights_until)<=Date.now())return {status:'not_ready'};
 const [job]=await db<{snapshot:unknown;state:string}[]>(`icash_screening_jobs?id=eq.${screeningId}&account_id=eq.${accountId}&select=snapshot,state`);
 if(job?.state!=='complete')return {status:'financial_hold'};
 const propertyId=(job.snapshot as {propertyId?:string})?.propertyId;
 if(!propertyId||!/^prop_\d+$/.test(propertyId))return {status:'financial_hold'};
 const [control]=await db<{manual:boolean}[]>(`icash_property_controls?account_id=eq.${accountId}&property_id=eq.${propertyId}&select=manual`);
 if(control?.manual)return {status:'manual_control'};
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;costs_micros:{dealmachine:number}}[]>(`icash_operation_rates?id=eq.${c.contact_rate_id}&select=operation,enabled,expires_at,costs_micros`);
 if(!rate?.enabled||rate.operation!=='owner_enrichment'||Date.parse(rate.expires_at)<=Date.now())return {status:'rate_required'};
 const key=process.env.DEALMACHINE_API_KEY;if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 const operationKey=`owners:${accountId}:${screeningId}`;
 return enrichOwners({snapshot:job.snapshot,creditCap:c.contact_credit_cap,unitCostMicros:c.property_credit_micros,quotedDataCostMicros:rate.costs_micros.dealmachine},{
  reserveAndClaim:async()=>{await dispatchReservedOperation({accountId,operationKey,rateId:c.contact_rate_id,permissionUntil:c.data_rights_until},async()=>true);return true;},
  fetchOwners:async id=>{
   if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw new Error('PROVIDER_RATE_LIMIT');
   try{
    const r=await fetch(`https://api.v2.dealmachine.com/v1/properties/${id}?enrich=true&contact_audience=owners&fields=estimated_value`,{headers:{Authorization:`Bearer ${key}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error();return await r.json();
   }catch{throw new Error('OWNER_LOOKUP_FAILED_NO_RETRY');}
  },
  persist:async result=>{await db('rpc/icash_save_contacts','POST',{p_account:accountId,p_screening:screeningId,p_operation:operationKey,p_result:result});},
 });
}
