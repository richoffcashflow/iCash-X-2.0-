import {discoveryWorkEnabled,liveWorkReady} from './live-work-admission.ts';
import {propertyResearchMarketKnown} from '@/lib/contract-coverage-service';
import {db} from '@/lib/stripe-test';
import {discoverPage} from './discovery-pipeline.ts';
type Config={account_id:string;enabled:boolean;zip:string;rate_id:string;property_credit_micros:number;data_rights_until:string;per_page:number;next_page:number;revision:string;exhausted:boolean};
/** Called only with a server-resolved authenticated account. All policy lives in service-only DB rows. */
export async function discoverForAccount(accountId:string){
 if(!discoveryWorkEnabled())return {status:'live_work_not_ready'};
 if(process.env.ICASH_ACQUISITION_MODE==='hybrid'&&!await db<boolean>('rpc/icash_outbound_search_due','POST',{p_account:accountId}))return {status:'supply_target_met'};
 const [c]=await db<Config[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=*`);
 if(!c?.enabled||c.exhausted||!(Date.parse(c.data_rights_until)>Date.now()))return {status:'not_ready'};
 // The independent release is limited to the supported property-only five-record page.
 if(!liveWorkReady()&&(!Number.isSafeInteger(c.per_page)||c.per_page<1||c.per_page>5))return {status:'discovery_page_limit'};
 // Property-only discovery is independent of downstream contract-template coverage.
 // The same configured-market check applies to both release modes.
 if(!await propertyResearchMarketKnown(c.zip,accountId))return {status:'market_configuration_required'};
 const [setup]=await db<{revision:number;profile:{marketMode?:string;market?:string}}[]>(`icash_bot_setups?account_id=eq.${accountId}&select=revision,profile`);
 const [account]=await db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused`);
 const [wallet]=await db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents`);
 if(!account||account.bot_paused||!wallet||wallet.balance_cents<=wallet.reserved_cents)return {status:'paused'};
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;costs_micros:{dealmachine:number}}[]>(`icash_operation_rates?id=eq.${c.rate_id}&select=operation,enabled,expires_at,costs_micros`);
 if(!rate?.enabled||rate.operation!=='property_search'||!(Date.parse(rate.expires_at)>Date.now()))return {status:'rate_required'};
 const key=process.env.DEALMACHINE_API_KEY;
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 const operationKey=`discovery:${accountId}:${c.revision}:${c.next_page}`;
 const [existing]=await db<{state:string}[]>(`icash_operation_spend?operation_key=eq.${operationKey}&select=state`);
 if(existing&&existing.state!=='reserved')return {status:'awaiting_reconciliation'};
 const result=await discoverPage({zip:c.zip,page:c.next_page,perPage:c.per_page,unitCostMicros:c.property_credit_micros,quotedDataCostMicros:rate.costs_micros.dealmachine},{
  request:async body=>{
   if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw new Error('DISCOVERY_RATE_LIMIT');
   try{
    const r=await fetch('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error();return await r.json();
   }catch{throw new Error('DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY');}
  },
  // Scope validation, reservation and one-use claim share one locked DB transaction.
  reserveAndClaim:()=>db<boolean>('rpc/icash_reserve_and_claim_property_discovery','POST',{p_account:accountId,p_zip:c.zip,p_revision:c.revision,p_page:c.next_page,p_per_page:c.per_page,p_rate:c.rate_id,p_unit:c.property_credit_micros,p_permission_until:c.data_rights_until,p_setup_revision:setup?.revision??null,p_market_mode:setup?.profile?.marketMode??null,p_market:setup?.profile?.market??null}),
  persist:async result=>{await db('rpc/icash_save_discovery','POST',{p_account:accountId,p_operation:operationKey,p_revision:c.revision,p_page:c.next_page,p_result:result});},
 });
 if(result.status==='empty')await db('rpc/icash_mark_inventory_empty','POST',{p_account:accountId,p_revision:c.revision,p_page:c.next_page});
 return result;
}
