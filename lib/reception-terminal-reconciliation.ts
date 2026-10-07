import {observeLegacyReceptionCosts} from './legacy-reception-cost-observation.ts';
import {receptionTarget} from './general-reception.ts';

// Carrier completion and final billing are separate facts. This records only
// fresh canonical completion evidence; it never settles or releases money.
export async function reconcileReceptionTerminals(env:Record<string,string|undefined>,rpc:(name:string,body:Record<string,unknown>)=>Promise<unknown>,fetcher:typeof fetch=fetch){
 const observations=await observeLegacyReceptionCosts(env,fetcher);
 let verified=0;
 for(const evidence of observations){
  if(!('terminal' in evidence)||evidence.terminal!==true)continue;
  const saved=await rpc('icash_attest_reception_terminal',{p_account:receptionTarget.accountId,p_user:receptionTarget.ownerUserId,p_evidence:evidence});
  if(saved===true)verified++;
 }
 return {verified,total:observations.length,billingUnchanged:true};
}
