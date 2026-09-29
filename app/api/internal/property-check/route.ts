import {createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {loadTestProperty} from '@/lib/dealmachine-property';
import {samePropertyAddress} from '@/lib/property-address-match';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return new Response(null,{status:401,headers});
 const key=process.env.DEALMACHINE_API_KEY;
 if(!key)return new Response(null,{status:503,headers});
 let job:{id:string;propertyId:string;expectedAddress:string}|null=null;
 try{
  job=await db('rpc/icash_claim_property_check','POST',{p_hash:createHash('sha256').update(token).digest('hex')});
  if(!job)return new Response(null,{status:409,headers});
  if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw Error('Rate limit');
  const property=await loadTestProperty(job.propertyId,key);
  const addressMatched=samePropertyAddress(property.address,job.expectedAddress);
  await db(`icash_property_checks?id=eq.${job.id}&state=eq.started`,'PATCH',{state:addressMatched?'complete':'held',result:{property,addressMatched,reason:addressMatched?null:'address_mismatch',offerAuthorized:false,outreachAuthorized:false},completed_at:new Date().toISOString()});
  if(property.vendorCreditsUsed!==null)await db('rpc/icash_record_cost_observation','POST',{p_provider:'dealmachine',p_event:`property-check:${job.id}`,p_source:`property-check:${job.id}`,p_amount:property.vendorCreditsUsed,p_units:'provider_credits'});
  return Response.json({status:addressMatched?'complete':'address_review_required'},{headers});
 }catch{
  if(job)try{await db(`icash_property_checks?id=eq.${job.id}&state=eq.started`,'PATCH',{state:'held',result:{reason:'provider_or_storage_outcome_unknown_no_retry'},completed_at:new Date().toISOString()});}catch{}
  return Response.json({status:'held_no_retry'},{status:503,headers});
 }
}
