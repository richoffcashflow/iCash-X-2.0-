import {discoveryWorkEnabled,liveWorkReady} from './live-work-admission.ts';
import {propertyResearchMarketKnown} from '@/lib/contract-coverage-service';
import {db} from '@/lib/stripe-test';
import {discoverPage} from './discovery-pipeline.ts';
import {selectDiscoveryFilter,DiscoveryFilterUnavailable} from './discovery-filters.ts';
import {dealMachineRequest} from './dealmachine-request.ts';
import {syncResearchExclusions} from './research-exclusions.ts';
import {requestDiscoveryEstimate,DiscoveryEstimateHeld} from './discovery-estimate.ts';
type Config={account_id:string;enabled:boolean;zip:string;rate_id:string;property_credit_micros:number;data_rights_until:string;per_page:number;next_page:number;revision:string;exhausted:boolean;research_version?:number;research_list_id?:string|null};
class DiscoveryProviderRequestError extends Error{
 constructor(readonly stage:'estimate'|'paid',readonly httpStatus:number|null){super('DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY');}
}
/** Called only with a server-resolved authenticated account. All policy lives in service-only DB rows. */
export async function discoverForAccount(accountId:string){
 const providerDeadline=AbortSignal.timeout(90000);
 if(!discoveryWorkEnabled())return {status:'live_work_not_ready'};
 if(process.env.ICASH_ACQUISITION_MODE==='hybrid'&&!await db<boolean>('rpc/icash_outbound_search_due','POST',{p_account:accountId}))return {status:'supply_target_met'};
 await syncResearchExclusions(db).catch(()=>null);
 await db('rpc/icash_prepare_research_efficiency','POST',{p_account:accountId});
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
 const inventory=await db<string>('rpc/icash_prepare_discovery_inventory','POST',{p_account:accountId,p_revision:c.revision,p_page:c.next_page});
 if(inventory!=='ready')return {status:inventory};
 const state=await db<unknown>('rpc/icash_discovery_filter_state_v2','POST',{p_account:accountId,p_revision:c.revision,p_page:c.next_page});
 const shared=state===null?[]:await db('rpc/icash_discovery_shared_evidence','POST',{p_account:accountId,p_zip:c.zip}).catch(()=>[]);
 const filterPlan=state===null?undefined:selectDiscoveryFilter(state,c.next_page,shared);
 if(filterPlan===null){
  if(Array.isArray(state)&&state.some(s=>s?.blocked===true&&s?.exhausted===false))return {status:'inventory_held'};
  await db('rpc/icash_mark_inventory_empty','POST',{p_account:accountId,p_revision:c.revision,p_page:c.next_page});return {status:'empty'};
 }
 const finishEmpty=(reason:'empty'|'unavailable')=>filterPlan
  ?db('rpc/icash_finish_empty_filter','POST',{p_account:accountId,p_revision:c.revision,p_page:c.next_page,p_plan:filterPlan,p_reason:reason})
  :db('rpc/icash_mark_inventory_empty','POST',{p_account:accountId,p_revision:c.revision,p_page:c.next_page});
 const queryPolicy=c.research_version===2?{version:'research-efficiency-v2' as const,exclusionListId:c.research_list_id??null}:c.research_version===1?{version:'research-efficiency-v1' as const,exclusionListId:c.research_list_id??null}:undefined;
 const scope={p_account:accountId,p_zip:c.zip,p_revision:c.revision,p_page:c.next_page,p_per_page:c.per_page,p_rate:c.rate_id,p_unit:c.property_credit_micros,p_permission_until:c.data_rights_until,p_setup_revision:setup?.revision??null,p_market_mode:setup?.profile?.marketMode??null,p_market:setup?.profile?.market??null};
 try{
 const result=await discoverPage({zip:c.zip,page:c.next_page,perPage:c.per_page,unitCostMicros:c.property_credit_micros,quotedDataCostMicros:rate.costs_micros.dealmachine,...(filterPlan?{filterPlan}:{}),...(queryPolicy?{queryPolicy}:{})},{
  request:async body=>{
   const stage=(body as {estimate_cost?:boolean}).estimate_cost===true?'estimate':'paid';let httpStatus:number|null=null;
   const requestOnce=async()=>{try{
    const r=await dealMachineRequest(db,stage==='estimate'?'search_estimate':'property_search',()=>fetch('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.any([providerDeadline,AbortSignal.timeout(stage==='estimate'?20000:60000)])}),{accountId,operationKey});
    httpStatus=r.status;
    if(!r.ok){
     // An unsupported FREE estimate may retire a test arm. A paid request,
     // authentication error, rate limit or timeout must never trigger a replay.
     if(filterPlan&&filterPlan.strategy!=='baseline'&&(body as {estimate_cost?:boolean}).estimate_cost===true&&[400,422].includes(r.status))throw new DiscoveryFilterUnavailable();
     throw new Error();
    }return r.raw;
   }catch(error){if(error instanceof DiscoveryFilterUnavailable)throw error;throw new DiscoveryProviderRequestError(stage,httpStatus);}};
   return stage==='estimate'?requestDiscoveryEstimate(db,accountId,scope,filterPlan,queryPolicy,body,requestOnce):requestOnce();
  },
  // Scope validation, reservation and one-use claim share one locked DB transaction.
  reserveAndClaim:()=>{
   providerDeadline.throwIfAborted();
   return queryPolicy?db<boolean>('rpc/icash_reserve_research_discovery','POST',{p_account:accountId,p_scope:scope,p_plan:filterPlan??null,p_policy:queryPolicy}):db<boolean>(filterPlan?'rpc/icash_reserve_and_claim_filtered_discovery':'rpc/icash_reserve_and_claim_property_discovery','POST',{...scope,...(filterPlan?{p_plan:filterPlan}:{})});
  },
  persist:async result=>{const queued=await db<number>(queryPolicy?'rpc/icash_save_research_discovery':filterPlan?'rpc/icash_save_filtered_discovery':'rpc/icash_save_discovery','POST',{p_account:accountId,p_operation:operationKey,p_revision:c.revision,p_page:c.next_page,p_result:result});await db('rpc/icash_settle_dealmachine_usage','POST',{p_operation:operationKey});return queued;},
 });
 if(result.status==='empty')await finishEmpty('empty');
 return result;
 }catch(error){if(error instanceof DiscoveryEstimateHeld)return {status:'inventory_held'};if(error instanceof DiscoveryFilterUnavailable){await finishEmpty('unavailable');return {status:'empty'};}throw error;}
}
