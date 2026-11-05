import {discoveryFields} from './discovery-pipeline.ts';
import {qualifySellerProperty} from './seller-qualification.ts';
import {dealMachineAddress,sellerAddressReceipt,type DealMachineAddress} from './dealmachine-address.ts';
import {finishAdmittedDealMachineRequest} from './dealmachine-request.ts';
export type SellerDb=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Lookup={id:string;token:string;address:string;assignmentFeeCents:number;sellerCostReserveCents:number;quotaRequestId?:string;demoExpiresAt?:string;noAddressFallback?:boolean};
/** At most one charged property per claim. A definitive zero-credit no-match can
 * use one alternate address format. A timeout or charged result is never replayed. */
export async function processSellerIntake(db:SellerDb,key:string|undefined,transport:typeof fetch=fetch,leadId?:string,lookupBudgetMs=15000){
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 // The versioned RPC selects an eligible exact claim and admits quota in one
 // transaction. A missing RPC fails closed; never fall back to separate admission.
 const admitted=await db<Lookup|{status:'rate_limited'|'admission_busy'}|null>(leadId?'rpc/icash_claim_seller_lookup_admitted_for':'rpc/icash_claim_seller_lookup_admitted','POST',leadId?{p_id:leadId}:{});
 if(admitted&&'status' in admitted&&admitted.status==='admission_busy')return {status:'rate_limited'};
 if(admitted&&'status' in admitted&&admitted.status!=='rate_limited')throw Error('SELLER_ADMISSION_INVALID');
 const ordinary=!(admitted&&'status' in admitted&&admitted.status==='rate_limited');
 if(!ordinary&&!leadId)return {status:'rate_limited'};
 const claim=ordinary?admitted as Lookup|null
  :await db<Lookup|null>('rpc/icash_claim_owner_demo_lookup','POST',{p_id:leadId});
 if(!ordinary&&!claim)return {status:'rate_limited'};
 if(!claim)return {status:'idle_or_setup_required'};
 const demoExpires=ordinary?Infinity:Date.parse(claim.demoExpiresAt??'');
 const deadline=Math.min(Date.now()+Math.max(1000,Math.min(15000,lookupBudgetMs)),demoExpires);
 let stage='format',httpStatus:number|null=null,raw:unknown=null,input:DealMachineAddress|null=null;
 const attempts:{lookup:ReturnType<typeof sellerAddressReceipt>;creditsUsed:number}[]=[];
 try{
  if(!ordinary&&(claim.id!==leadId||claim.noAddressFallback!==true||!Number.isFinite(demoExpires)
   ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.quotaRequestId??'')))throw Error('OWNER_DEMO_LOOKUP_CLAIM_INVALID');
  const lookup=async()=>{
   stage='provider_request';raw=null;httpStatus=null;
   const request=()=>{
    if(!ordinary&&Date.now()>=demoExpires)throw Error('OWNER_DEMO_LOOKUP_REQUEST_EXPIRED');
    return transport('https://api.v2.dealmachine.com/v1/enrichment/address',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({data:[input],fields:[...discoveryFields,'property_type'],contact_audience:'none'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
   };
   if(ordinary){
    const r=await request();httpStatus=r.status;
    if(!r.ok)throw Error('Provider response needs review');
    stage='provider_decode';raw=await r.json();
   }else{
    const r=await finishAdmittedDealMachineRequest(db,claim.quotaRequestId!,request);
    httpStatus=r.status;raw=r.raw;
    if(!r.ok)throw Error('Provider response needs review');
   }
   stage='qualification';
   const output=qualifySellerProperty(raw,{assignmentFeeCents:claim.assignmentFeeCents,sellerCostReserveCents:claim.sellerCostReserveCents});
   attempts.push({lookup:sellerAddressReceipt(input!,raw),creditsUsed:output.creditsUsed});
   return output;
  };
  input=dealMachineAddress(claim.address);
  let output=await lookup();
  if(ordinary&&deadline-Date.now()>1000&&output.status==='unmatched'&&output.creditsUsed===0&&'street' in input&&['not_found','no_match'].includes(attempts[0].lookup.failureCode??'')&&await db<boolean>('rpc/icash_take_dealmachine_request','POST',{})){
   const alternate={full_address:[input.street+(input.unit?' '+input.unit:''),input.city,input.state+(input.zip?' '+input.zip:'')].join(', ')};
   // Store the definitive no-charge receipt before the only fallback. A lost
   // response remains held by the original claim, including after a crash.
   stage='fallback_receipt';
   const receipt=await db<{id:string}[]>(`icash_seller_intakes?id=eq.${claim.id}&claim_token=eq.${claim.token}&state=eq.checking&select=id`,'PATCH',{result:{addressLookup:attempts[0].lookup,addressAttempts:attempts,addressFallback:alternate}});
   if(receipt.length!==1)throw Error('LOOKUP_CLAIM_CHANGED');
   input=alternate;output=await lookup();
  }
  const result={...output.result,addressLookup:sellerAddressReceipt(input,raw),addressAttempts:attempts};
  stage='persistence';
  const saved=await db<boolean>('rpc/icash_finish_seller_lookup','POST',{p_id:claim.id,p_token:claim.token,p_output:{...output,result}});
  return {status:saved?'property_checked':'lookup_requires_review'};
 }catch(error){
  // No release or retry: the provider may have charged even if no response arrived.
  const code=error instanceof Error&&/^[A-Z_]{5,80}$/.test(error.message)?error.message:'LOOKUP_REQUIRES_REVIEW';
  const failure={stage,httpStatus,code,at:new Date().toISOString()};
  console.warn('seller_lookup_requires_review',{leadId:claim.id,...failure});
  // Keep a bounded private receipt so format/qualification failures can be
  // repaired from evidence without spending another provider credit.
  try{
   if(!ordinary&&claim.id!==leadId)return {status:'lookup_requires_review'};
   const providerResponse=raw&&JSON.stringify(raw).length<=48000?raw:null;
   await db(`icash_seller_intakes?id=eq.${claim.id}&claim_token=eq.${claim.token}&state=eq.checking`,'PATCH',{
    state:'review',hold_reason:`Lookup needs review at ${stage}; no automatic retry`,
    result:{lookupFailure:failure,addressLookup:input?sellerAddressReceipt(input,raw):null,addressAttempts:attempts,providerResponse},
   });
  }catch{/* Preserve the original claim and reservation if receipt storage fails. */}
  return {status:'lookup_requires_review'};
 }
}
