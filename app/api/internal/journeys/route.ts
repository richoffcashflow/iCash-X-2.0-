import {db} from '@/lib/stripe-test';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {sendForSignatures} from '@/lib/signing-service';
import {textPendingContract} from '@/lib/contract-text-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {coordinateTitleOpening} from '@/lib/title-service';
import {processDealJourneys} from '@/lib/deal-journey-service';
import {processOwnerBuyerDelivery} from '@/lib/owner-buyer-delivery-service';
import {processDealSupervisor} from '@/lib/deal-supervisor';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function GET(req:Request){
 const headers={'Cache-Control':'no-store'};
 if(!authorizeOutboundBilling(req,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 const supervisor=await processDealSupervisor(db,process.env);
 const ownerDelivery=await processOwnerBuyerDelivery({db,dispatch:dispatchTextMessage},process.env).catch(()=>({status:'owner_delivery_needs_review'}));
 try{
  const result=await processDealJourneys({db,send:sendForSignatures,text:textPendingContract,dispatch:dispatchTextMessage,title:coordinateTitleOpening},process.env);
  return Response.json({...result,ownerDelivery,supervisor},{status:result.status==='journey_processing_needs_review'||ownerDelivery.status==='owner_delivery_needs_review'||supervisor.errors>0?503:200,headers});
 }
 catch{return Response.json({status:'journey_processing_needs_review',ownerDelivery,supervisor},{status:503,headers});}
}
