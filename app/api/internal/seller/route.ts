import {processInstantLeadWork} from '@/lib/meta-instant-lead-service';
import {db} from '@/lib/stripe-test';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {processSellerIntake} from '@/lib/seller-pipeline';
import {processSellerResearchRefresh} from '@/lib/seller-research-refresh';
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
 const instantWork=processInstantLeadWork({db,sms:dispatchTextMessage,voice:dispatchLiveVoice,env:process.env}).catch(()=>({status:'instant_lead_retry_pending'}));
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
 // Existing paid leads must keep progressing during a new-address provider
 // outage or when acquisition is disabled. Final channel claims own dispatch.
 let responseFailed=false;
 const responseWork=processSellerResponses(db,dispatchTextMessage,dispatchLiveVoice).catch(()=>{
  responseFailed=true;return [];
 });
 // Delayed shared assignments can outlive their original research. Refresh
 // only unsent work; current responses and new intake remain independent.
 const researchRefresh=processSellerResearchRefresh(db,process.env.DEALMACHINE_API_KEY).catch(()=>({status:'research_refresh_requires_review'}));
 try{
  const [controls]=await db<{enabled:boolean}[]>('icash_seller_controls?id=eq.1&select=enabled');
  if(!controls?.enabled)return Response.json({status:'seller_setup_required',instantLeads:await instantWork,responses:await responseWork,measurement:await measurementWork,agreementRecovery:await agreementRecovery,researchRefresh:await researchRefresh},{status:responseFailed?503:200,headers});
  let lookupFailed=false;
  const lookup=await processSellerIntake(db,process.env.DEALMACHINE_API_KEY).catch(()=>{
   lookupFailed=true;return {status:'seller_lookup_unavailable'};
  });
  const allocation=await db<{status:string;leadId?:string}|null>('rpc/icash_assign_seller_lead','POST',{});
  // A recovered intake gets the same immediate handoff as a form submission.
  // Older setup retries must not take the newly assigned lead's response slot.
  const immediate=allocation?.status==='assigned'?await processSellerResponses(db,dispatchTextMessage,dispatchLiveVoice,allocation.leadId):[];
  const responses=[...await responseWork,...immediate];
  const measurement=await measurementWork;
  return Response.json({instantLeads:await instantWork,lookup,allocation,responses,measurement,agreementRecovery:await agreementRecovery,researchRefresh:await researchRefresh},{status:lookupFailed||responseFailed?503:200,headers});
 }catch{await Promise.all([agreementRecovery,measurementWork,responseWork,instantWork,researchRefresh]);return Response.json({status:'seller_processing_requires_review'},{status:503,headers});}
}
