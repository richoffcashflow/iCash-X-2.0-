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
