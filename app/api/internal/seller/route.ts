import {db} from '@/lib/stripe-test';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {processSellerIntake} from '@/lib/seller-pipeline';
import {deliverSellerEvent} from '@/lib/seller-conversions';
import {processSellerResponses} from '@/lib/seller-response-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
import {recoverAgreementDelivery} from '@/lib/agreement-delivery-recovery';
import {sendForSignatures} from '@/lib/signing-service';
import {textPendingContract} from '@/lib/contract-text-service';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function GET(req:Request){
 const headers={'Cache-Control':'no-store'};
 if(!authorizeOutboundBilling(req,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 // Recovery is independent of new seller intake. A failed or slow receipt
 // lookup must not delay a newly submitted property's first response.
 const agreementRecovery=recoverAgreementDelivery({db,send:sendForSignatures,text:textPendingContract},process.env).catch(()=>{
   console.warn('seller_agreement_recovery_unavailable');
   return {status:'agreement_recovery_unavailable'};
 });
 // Saved conversion receipts do not depend on lookup funding or call dispatch.
 const measurementWork=(async()=>{
  await db('rpc/icash_collect_seller_milestones','POST',{});
  return deliverSellerEvent(db,process.env);
 })().catch(()=>({status:'measurement_retry_pending'}));
 try{
  const [controls]=await db<{enabled:boolean}[]>('icash_seller_controls?id=eq.1&select=enabled');
  if(!controls?.enabled)return Response.json({status:'seller_setup_required',measurement:await measurementWork,agreementRecovery:await agreementRecovery},{headers});
  const lookup=await processSellerIntake(db,process.env.DEALMACHINE_API_KEY);
  const allocation=await db<{status:string;leadId?:string}|null>('rpc/icash_assign_seller_lead','POST',{});
  // A recovered intake gets the same immediate handoff as a form submission.
  // Older setup retries must not take the newly assigned lead's response slot.
  const responses=await processSellerResponses(db,dispatchTextMessage,dispatchLiveVoice,allocation?.status==='assigned'?allocation.leadId:undefined);
  const measurement=await measurementWork;
  return Response.json({lookup,allocation,responses,measurement,agreementRecovery:await agreementRecovery},{headers});
 }catch{await Promise.all([agreementRecovery,measurementWork]);return Response.json({status:'seller_processing_requires_review'},{status:503,headers});}
}
