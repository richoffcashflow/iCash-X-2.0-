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
 try{
  const agreementRecovery=await recoverAgreementDelivery({db,send:sendForSignatures,text:textPendingContract},process.env);
  const [controls]=await db<{enabled:boolean}[]>('icash_seller_controls?id=eq.1&select=enabled');
  if(!controls?.enabled)return Response.json({status:'seller_setup_required'},{headers});
  await db('rpc/icash_collect_seller_milestones','POST',{});
  const lookup=await processSellerIntake(db,process.env.DEALMACHINE_API_KEY);
  const allocation=await db('rpc/icash_assign_seller_lead','POST',{});
  const responses=await processSellerResponses(db,dispatchTextMessage,dispatchLiveVoice);
  const measurement=await deliverSellerEvent(db,process.env);
  return Response.json({lookup,allocation,responses,measurement,agreementRecovery},{headers});
 }catch{return Response.json({status:'seller_processing_requires_review'},{status:503,headers});}
}
