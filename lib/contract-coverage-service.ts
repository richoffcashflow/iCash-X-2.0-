import {db} from '@/lib/stripe-test';
import {contractCapability,reviewedContractCoverage,type ContractTemplateCapability} from './contract-coverage.ts';
export async function readContractCoverage(){
 const templates=await db<ContractTemplateCapability[]>('icash_signing_templates?enabled=eq.true&test_mode=eq.false&provider=eq.docuseal&select=state_code,kind,signer_count,enabled,test_mode,provider,reviewed_until,rate:icash_operation_rates(operation,enabled,expires_at)&limit=801');
 // Bound data transfer and fail closed rather than silently missing coverage rows.
 if(templates.length>800)throw Error('Contract coverage requires review');
 return reviewedContractCoverage(templates);
}
export async function acquisitionContractCoverage(zip:string){
 if(!/^\d{5}$/.test(zip))return {supported:false,reason:'Research only: market state is not verified.'};
 const [markets,coverage]=await Promise.all([db<{state:string}[]>(`icash_market_shortlist?zip=eq.${zip}&select=state&limit=2`),readContractCoverage()]);
 const state=markets.length===1?markets[0].state:null;
 return {...contractCapability(coverage,state,1),state,coverage};
}

/** Property-only research needs a configured market, not an executable purchase agreement. */
export async function propertyResearchMarketKnown(zip:string,accountId?:string){
 if(!/^\d{5}$/.test(zip))return false;
 if(accountId){
  const [setup]=await db<{profile?:{marketMode?:string;market?:string}}[]>(`icash_bot_setups?account_id=eq.${accountId}&select=profile`);
  const requested=setup?.profile?.market?.trim();
  if(setup?.profile?.marketMode==='city'&&requested&&/^\d{5}$/.test(requested)&&requested!==zip)return false;
 }
 const markets=await db<{state:string}[]>(`icash_market_shortlist?zip=eq.${zip}&select=state&limit=2`);
 if(markets.length)return markets.length===1&&/^[A-Z]{2}$/.test(markets[0].state);
 if(!accountId)return false;
 // Cache rows contain geography only and are written solely by the bounded provider resolver.
 try{
  const matches=await db<{state_code:string;property_count:number;checked_at:string;expires_at:string}[]>(`icash_property_zip_geographies?zip=eq.${zip}&select=state_code,property_count,checked_at,expires_at&limit=2`);
  const g=matches.length===1?matches[0]:null;
  return !!g&&/^[A-Z]{2}$/.test(g.state_code)&&g.property_count>0&&Date.parse(g.checked_at)<=Date.now()&&Date.parse(g.expires_at)>Date.now();
 }catch{return false;}
}
