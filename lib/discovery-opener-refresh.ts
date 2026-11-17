import {finishAdmittedDealMachineRequest,type ResearchDb} from './dealmachine-request.ts';
import {qualifySellerProperty} from './seller-qualification.ts';

type Claim={id:string;requestId:string;quotaRequestId:string;kind:'property'|'dnc';request:Record<string,unknown>};
type Receipt={id:string;renewalId:string;raw:unknown;requestedAt:string;assignmentFeeCents:number;sellerCostReserveCents:number};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** No route/scheduler invokes this inactive operator-targeted worker. Each call
 * can acquire at most one new provider request. Receipt recovery never repeats
 * an HTTP request, even after a timeout or a lost database acknowledgement. */
export async function processDiscoveryOpenerRefresh(db:ResearchDb,key:string|undefined,renewalId:string,transport:typeof fetch=fetch){
 if(!uuid(renewalId))return {status:'renewal_invalid'};
 const qualify=async()=>{
  const saved=await db<Receipt|null>('rpc/icash_discovery_opener_refresh_receipt','POST',{p_id:renewalId});
  if(!saved)return true;
  if(saved.renewalId!==renewalId||!uuid(saved.id)||!Number.isFinite(Date.parse(saved.requestedAt)))return false;
  try{
   // Reuse the real financial model on the immutable new response. Never read
   // clock time to relabel the old source, or copy the previous eligible result.
   const output=qualifySellerProperty(saved.raw,{assignmentFeeCents:saved.assignmentFeeCents,sellerCostReserveCents:saved.sellerCostReserveCents},Date.parse(saved.requestedAt));
   return await db<boolean>('rpc/icash_qualify_discovery_opener_refresh','POST',{p_id:saved.id,p_output:output})===true;
  }catch{return false;}
 };
 try{
  await db('rpc/icash_resume_discovery_opener_refresh','POST',{p_id:renewalId});
  if(!await qualify())return {status:'renewal_underwriting_review'};
  if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'renewal_not_configured'};
  const claim=await db<Claim|null>('rpc/icash_claim_discovery_opener_refresh','POST',{p_id:renewalId});
  if(!claim)return {status:'renewal_idle_or_review'};
  if(claim.id!==renewalId||!uuid(claim.requestId)||!uuid(claim.quotaRequestId)||!['property','dnc'].includes(claim.kind)
   ||!claim.request||typeof claim.request!=='object')return {status:'renewal_claim_review'};
  const endpoint=claim.kind==='property'?'enrichment/address':'phones/dnc';
  const response=await finishAdmittedDealMachineRequest(db,claim.quotaRequestId,()=>transport('https://api.v2.dealmachine.com/v1/'+endpoint,{
   method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(claim.request),
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  }));
  const receipt={p_id:claim.requestId,p_request:claim.quotaRequestId,p_status:response.status,p_response:response.raw};
  const save=()=>db<boolean>('rpc/icash_record_discovery_opener_refresh','POST',receipt);
  if(await save().catch(()=>save())!==true)return {status:'renewal_receipt_review'};
  // Even non-200/malformed/negative responses remain saved before qualification.
  await db('rpc/icash_resume_discovery_opener_refresh','POST',{p_id:renewalId});
  if(claim.kind==='property'&&!await qualify())return {status:'renewal_underwriting_review'};
  return await db<{status:string}>('rpc/icash_resume_discovery_opener_refresh','POST',{p_id:renewalId});
 }catch{return {status:'renewal_requires_review'};}
}
