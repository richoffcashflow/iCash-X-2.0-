import {discoveryFields} from './discovery-pipeline.ts';
import {qualifySellerProperty} from './seller-qualification.ts';
import {dealMachineAddress,sellerAddressReceipt} from './dealmachine-address.ts';
export type SellerDb=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Lookup={id:string;token:string;address:string;assignmentFeeCents:number;sellerCostReserveCents:number};
/** One bounded paid address lookup per durable claim. A timeout is never replayed. */
export async function processSellerIntake(db:SellerDb,key:string|undefined,transport:typeof fetch=fetch,leadId?:string){
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 // Rate admission precedes the claim so local throttling cannot strand a paid hold.
 if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))return {status:'rate_limited'};
 const claim=await db<Lookup|null>(leadId?'rpc/icash_claim_seller_lookup_for':'rpc/icash_claim_seller_lookup','POST',leadId?{p_id:leadId}:{});
 if(!claim)return {status:'idle_or_setup_required'};
 try{
  const input=dealMachineAddress(claim.address);
  const r=await transport('https://api.v2.dealmachine.com/v1/enrichment/address',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({data:[input],fields:[...discoveryFields,'property_type'],contact_audience:'none'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Provider response needs review');
  const raw=await r.json();
  const output=qualifySellerProperty(raw,{assignmentFeeCents:claim.assignmentFeeCents,sellerCostReserveCents:claim.sellerCostReserveCents});
  const result={...output.result,addressLookup:sellerAddressReceipt(input,raw)};
  const saved=await db<boolean>('rpc/icash_finish_seller_lookup','POST',{p_id:claim.id,p_token:claim.token,p_output:{...output,result}});
  return {status:saved?'property_checked':'lookup_requires_review'};
 }catch{
  // No release or retry: the provider may have charged even if no response arrived.
  return {status:'lookup_requires_review'};
 }
}
