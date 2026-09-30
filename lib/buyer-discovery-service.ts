import {db} from '@/lib/stripe-test';
import {discoverBuyerPage} from './buyer-discovery.ts';
type Config={enabled:boolean;rate_id:string;unit_cost_micros:number;rights_until:string;revision:string;since:string;zip:string;max_pages:number;per_page:number};
export async function discoverBuyersForDeal(accountId:string,dealId:string){
 const [config]=await db<Config[]>(`icash_buyer_search_configs?account_id=eq.${accountId}&select=*`);
 if(!config?.enabled||!(Date.parse(config.rights_until)>Date.now())||!process.env.DEALMACHINE_API_KEY)return {status:'buyer_search_configuration_required',canContinue:false};
 const [deal]=await db<{screening_id:string;stage:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=screening_id,stage`);
 const [account]=await db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused`);
 const [signed]=await db<{id:string}[]>(`icash_signing_envelopes?deal_id=eq.${dealId}&account_id=eq.${accountId}&kind=eq.purchase&state=eq.completed&test_mode=eq.false&select=id&limit=1`);
 if(!deal||!signed||account?.bot_paused!==false||!['under_contract','buyer_selected'].includes(deal.stage))return {status:'buyer_search_held',canContinue:false};
 const [screen]=await db<{snapshot:{propertyId:string;raw?:{data?:{zip?:string}}}}[]>(`icash_screening_jobs?id=eq.${deal.screening_id}&account_id=eq.${accountId}&select=snapshot`);
 if(!screen||!/^prop_[A-Za-z0-9]+$/.test(screen.snapshot.propertyId))return {status:'buyer_search_held',canContinue:false};
 const dealZip=screen.snapshot.raw?.data?.zip;
 if(typeof dealZip!=='string'||!/^\d{5}(?:-\d{4})?$/.test(dealZip))return {status:'buyer_property_zip_required',canContinue:false};
 const controls=await db<unknown[]>(`icash_property_controls?account_id=eq.${accountId}&property_id=eq.${screen.snapshot.propertyId}&manual=eq.true&select=property_id`);if(controls.length)return {status:'buyer_search_held',canContinue:false};
 const [last]=await db<{page:number;has_next_page:boolean}[]>(`icash_buyer_search_receipts?deal_id=eq.${dealId}&revision=eq.${config.revision}&select=page,has_next_page&order=page.desc&limit=1`);
 if(last&&(!last.has_next_page||last.page>=config.max_pages))return {status:'buyer_search_complete',canContinue:false};
 const page=(last?.page??0)+1,operationKey=`buyers:${dealId}:${config.revision}:${page}`;
 const [existing]=await db<{state:string}[]>(`icash_operation_spend?operation_key=eq.${operationKey}&select=state`);
 if(existing&&existing.state!=='reserved')return {status:'buyer_receipt_reconciliation_required',canContinue:false};
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;costs_micros:{dealmachine:number}}[]>(`icash_operation_rates?id=eq.${config.rate_id}&select=operation,enabled,expires_at,costs_micros`);
 if(!rate?.enabled||rate.operation!=='buyer_discovery'||!(Date.parse(rate.expires_at)>Date.now()))return {status:'buyer_rate_required',canContinue:false};
 const result=await discoverBuyerPage({zip:dealZip.slice(0,5),page,perPage:config.per_page,since:config.since,unitCostMicros:config.unit_cost_micros,quotedCostMicros:rate.costs_micros.dealmachine},{
 request:async body=>{if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw Error('BUYER_SEARCH_RATE_LIMIT');const r=await fetch('https://api.v2.dealmachine.com/v1/properties/search',{method:'POST',headers:{Authorization:`Bearer ${process.env.DEALMACHINE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok)throw Error('BUYER_SEARCH_REQUEST_FAILED');return r.json();},
 claim:async()=>{
 // Fresh account/property/config checks and operation claim happen in one SQL transaction.
 await db('rpc/icash_reserve_operation','POST',{p_account:accountId,p_operation:operationKey,p_rate:config.rate_id,p_permission_until:config.rights_until});
 return db<boolean>('rpc/icash_claim_buyer_search','POST',{p_account:accountId,p_deal:dealId,p_revision:config.revision,p_operation:operationKey});
 },
 persist:async receipt=>{await db('rpc/icash_save_buyer_search','POST',{p_account:accountId,p_deal:dealId,p_revision:config.revision,p_page:page,p_operation:operationKey,p_receipt:receipt});}
 });
 return {...result,canContinue:result.canContinue&&page<config.max_pages};
}
