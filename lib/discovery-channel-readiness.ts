import {db} from '@/lib/stripe-test';
import {acquisitionContractCoverage,propertyResearchMarketKnown} from '@/lib/contract-coverage-service';
import {discoveryWorkEnabled,contactWorkEnabled,liveWorkReady} from './live-work-admission.ts';
import {runScreeningJob} from './screening-job.ts';
import {fullCostReserve,type CostQuote} from './cost-guard.ts';
type Readiness={ready:boolean;quote:{chargeCents:number;maxProperties?:number;maxContacts?:number;costBasis:'planning_estimate'}|null};
const held:Readiness={ready:false,quote:null};
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
/** Read-only Start availability. Pause is deliberately allowed here; atomic reservation/claim still enforces it. */
export async function discoveryAccountReadiness(accountId:string,userId:string):Promise<Readiness>{return dataAccountReadiness(accountId,userId,'property_search');}
export async function contactAccountReadiness(accountId:string,userId:string):Promise<Readiness>{return dataAccountReadiness(accountId,userId,'owner_enrichment');}
async function dataAccountReadiness(accountId:string,userId:string,operation:'property_search'|'owner_enrichment'):Promise<Readiness>{
 const contacts=operation==='owner_enrichment';
 if(!(contacts?contactWorkEnabled():discoveryWorkEnabled())||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(process.env.DEALMACHINE_API_KEY??''))return held;
 try{
  const [[config],[account],[wallet],[budget],[activation],funding,spend,usage]=await Promise.all([
   db<{enabled:boolean;auto_enabled:boolean;exhausted:boolean;zip:string;rate_id:string;per_page:number;property_credit_micros:number;data_rights_until:string;contacts_enabled:boolean;contact_rate_id:string;contact_credit_cap:number}[]>(`icash_discovery_configs?account_id=eq.${accountId}&select=enabled,auto_enabled,exhausted,zip,rate_id,per_page,property_credit_micros,data_rights_until,contacts_enabled,contact_rate_id,contact_credit_cap`),
   db<{owner_user_id:string;daily_limit_cents:number}[]>(`icash_accounts?id=eq.${accountId}&select=owner_user_id,daily_limit_cents`),
   db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents`),
   db<{enabled:boolean;require_company_reserve:boolean;standard_cost_multiplier:number;funded_micros:number;spent_micros:number;protected_micros:number;reserved_micros:number}[]>('icash_operating_budget?id=eq.1&select=enabled,require_company_reserve,standard_cost_multiplier,funded_micros,spent_micros,protected_micros,reserved_micros'),
   db<{enabled:boolean;customer_cap_cents:number}[]>(`icash_spend_activations?account_id=eq.${accountId}&select=enabled,customer_cap_cents`),
   db<{id:string}[]>(`icash_funding_orders?account_id=eq.${accountId}&mode=eq.live&state=eq.paid&credited_at=not.is.null&select=id&limit=1`),
   db<{state:string;charge_cap_cents:number;charged_cents:number|null}[]>(`icash_operation_spend?account_id=eq.${accountId}&state=in.(reserved,dispatched,settled)&select=state,charge_cap_cents,charged_cents&limit=1001`),
   db<{delta_cents:number}[]>(`icash_credit_ledger?account_id=eq.${accountId}&kind=eq.usage&created_at=gt.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&select=delta_cents&limit=1001`),
  ]);
  if(!config?.enabled||!config.auto_enabled||(!contacts&&config.exhausted)||!(Date.parse(config.data_rights_until)>Date.now())
   ||(!contacts&&(!Number.isSafeInteger(config.per_page)||config.per_page<1||config.per_page>5))||!integer(config.property_credit_micros)||config.property_credit_micros===0
   ||account?.owner_user_id!==userId||!wallet||!budget?.enabled||spend.length>1000||usage.length>1000)return held;
  if(contacts){
   if(!config.contacts_enabled||!config.contact_rate_id||!Number.isSafeInteger(config.contact_credit_cap)||config.contact_credit_cap<1||config.contact_credit_cap>25)return held;
   const candidate=await db<string|null>('rpc/icash_enrichment_candidate','POST',{p_account:accountId});
   if(!candidate)return held;
   const [screen]=await db<{snapshot:unknown;state:string}[]>(`icash_screening_jobs?id=eq.${candidate}&account_id=eq.${accountId}&select=snapshot,state`);
   if(screen?.state!=='complete'||runScreeningJob(screen.snapshot).financialCheck.status!=='eligible')return held;
   const prior=await db<unknown[]>(`icash_operation_spend?operation_key=eq.owners:${accountId}:${candidate}&select=state&limit=1`);
   if(prior.length)return held;
  }
  const rateId=contacts?config.contact_rate_id:config.rate_id;
  const quantity=contacts?config.contact_credit_cap:config.per_page;
  const [rate]=await db<{enabled:boolean;operation:string;version:string;charge_cents:number;costs_micros:CostQuote['amountsMicros'];buffer_bps:number;verified_at:string;expires_at:string}[]>(`icash_operation_rates?id=eq.${rateId}&select=enabled,operation,version,charge_cents,costs_micros,buffer_bps,verified_at,expires_at`);
  if(!rate?.enabled||rate.operation!==operation||!integer(rate.charge_cents)||rate.charge_cents===0)return held;
  const cost=fullCostReserve({rateVersion:rate.version,checkedAt:Date.parse(rate.verified_at),expiresAt:Date.parse(rate.expires_at),amountsMicros:rate.costs_micros,bufferBasisPoints:rate.buffer_bps},Date.now());
  if(!cost.ok||!Number.isFinite(budget.standard_cost_multiplier)||budget.standard_cost_multiplier<1)return held;
  const data=rate.costs_micros.dealmachine;
  if(data===null||BigInt(quantity)*BigInt(config.property_credit_micros)>BigInt(data))return held;
  const required=Math.ceil(cost.estimatedTotalMicros*budget.standard_cost_multiplier*(10000+rate.buffer_bps)/10000);
  if(!Number.isSafeInteger(required)||rate.charge_cents*10000<required)return held;
  const amounts=[wallet.balance_cents,wallet.reserved_cents,account.daily_limit_cents];
  if(!amounts.every(integer)||wallet.balance_cents-wallet.reserved_cents<rate.charge_cents)return held;
  let daily=0,lifetime=0;
  for(const entry of usage){if(!integer(-entry.delta_cents))return held;daily-=entry.delta_cents;}
  for(const entry of spend){const n=entry.state==='settled'?entry.charged_cents:entry.charge_cap_cents;if(n===null||!integer(n))return held;lifetime+=n;}
  if(!integer(daily)||!integer(lifetime)||daily+wallet.reserved_cents+rate.charge_cents>account.daily_limit_cents)return held;
  if(!budget.require_company_reserve){
   if(!activation?.enabled||!integer(activation.customer_cap_cents)||!funding.length||lifetime+rate.charge_cents>activation.customer_cap_cents)return held;
  }else if(![budget.funded_micros,budget.spent_micros,budget.protected_micros,budget.reserved_micros].every(integer)
   ||budget.funded_micros-budget.spent_micros-budget.protected_micros-budget.reserved_micros<cost.reserveCents*10000)return held;
  if(!contacts&&(liveWorkReady()?!(await acquisitionContractCoverage(config.zip)).supported:!await propertyResearchMarketKnown(config.zip)))return held;
  return {ready:true,quote:{chargeCents:rate.charge_cents,...(contacts?{maxContacts:quantity}:{maxProperties:quantity}),costBasis:'planning_estimate'}};
 }catch{return held;}
}
