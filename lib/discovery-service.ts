import {db} from '@/lib/stripe-test';
import {dispatchReservedOperation} from '@/lib/operating-costs';
import {discoverPage} from './discovery-pipeline.ts';
type Config={account_id:string;enabled:boolean;zip:string;rate_id:string;property_credit_micros:number;data_rights_until:string;per_page:number;next_page:number;revision:string;exhausted:boolean};
/** Called only with a server-resolved authenticated account. All policy lives in service-only DB rows. */
export async function discoverForAccount(accountId:string){
 const [c]=await db<Config[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
 if(!c?.enabled||c.exhausted||Date.parse(c.data_rights_until)<=Date.now())return {status:'not_ready'};
 const [account]=await db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused`);
 const [wallet]=await db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents`);
 if(!account||account.bot_paused||!wallet||wallet.balance_cents<=wallet.reserved_cents)return {status:'paused'};
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;costs_micros:{dealmachine:number}}[]>(`icash_operation_rates?id=eq.${c.rate_id}&select=operation,enabled,expires_at,costs_micros`);
 if(!rate?.enabled||rate.operation!=='property_search'||Date.parse(rate.expires_at)<=Date.now())return {status:'rate_required'};
 const key=process.env.DEALMACHINE_API_KEY;
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 const operationKey=`discovery:${accountId}:${c.revision}:${c.next_page}`;
 const [existing]=await db<{state:string}[]>(`icash_operation_spend?operation_key=eq.${operationKey}&select=state`);
 if(existing&&existing.state!=='reserved')return {status:'awaiting_reconciliation'};
 return discoverPage({zip:c.zip,page:c.next_page,perPage:c.per_page,unitCostMicros:c.property_credit_micros,quotedDataCostMicros:rate.costs_micros.dealmachine},{
  request:async body=>{
   if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw new Error('DISCOVERY_RATE_LIMIT');
   try{
    const r=await fetch('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error();return await r.json();
   }catch{throw new Error('DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY');}
  },
  reserveAndClaim:async()=>{
   await dispatchReservedOperation({accountId,operationKey,rateId:c.rate_id,permissionUntil:c.data_rights_until},async()=>true);
   return true;
  },
  persist:async result=>{await db('rpc/icash_save_discovery','POST',{p_account:accountId,p_operation:operationKey,p_revision:c.revision,p_page:c.next_page,p_result:result});},
 });
}
