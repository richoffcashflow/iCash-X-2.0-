import {finishAdmittedDealMachineRequest,type ResearchDb} from './dealmachine-request.ts';

type Claim={id:string;requestId:string;phone:string};
/** One durable, cost-admitted request for one due reminder. A missing response
 * stays held; recovery only processes an already saved provider receipt. */
export async function processSellerContactRefresh(db:ResearchDb,key:string|undefined,transport:typeof fetch=fetch){
 await db('rpc/icash_resume_seller_contact_refresh','POST',{});
 if(!key)return {status:'contact_refresh_not_configured'};
 const claim=await db<Claim|null>('rpc/icash_claim_seller_contact_refresh','POST',{});
 if(!claim)return {status:'contact_refresh_idle'};
 try{
  const result=await finishAdmittedDealMachineRequest(db,claim.requestId,()=>transport('https://api.v2.dealmachine.com/v1/phones/dnc',{
   method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
   body:JSON.stringify({phones:[{number:claim.phone}]}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  }));
  const receipt={p_id:claim.id,p_request:claim.requestId,p_status:result.status,p_response:result.raw};
  // Retry only the identical database write after a lost acknowledgement.
  const save=()=>db<boolean>('rpc/icash_record_seller_contact_refresh','POST',receipt);
  const saved=await save().catch(()=>save());
  if(!saved)return {status:'contact_refresh_receipt_review'};
  return await db<{status:string}>('rpc/icash_finish_seller_contact_refresh','POST',{p_id:claim.id});
 }catch{return {status:'contact_refresh_requires_review'};}
}
