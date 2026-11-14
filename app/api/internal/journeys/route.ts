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
 // Local queue repair and the owner's separately claimed package must not
 // consume customer journeys' execution window. Existing final claims still
 // serialize every side effect; observe all branches without retrying any one.
 const [supervisorWork,ownerWork,journeyWork]=await Promise.allSettled([
  Promise.resolve().then(()=>processDealSupervisor(db,process.env)),
  Promise.resolve().then(()=>processOwnerBuyerDelivery({db,dispatch:dispatchTextMessage},process.env)),
  Promise.resolve().then(()=>processDealJourneys({db,send:sendForSignatures,text:textPendingContract,dispatch:dispatchTextMessage,title:coordinateTitleOpening},process.env)),
 ]);
 const supervisor=supervisorWork.status==='fulfilled'?supervisorWork.value:{status:'unavailable',processed:0,repaired:0,errors:1};
 const ownerDelivery=ownerWork.status==='fulfilled'?ownerWork.value:{status:'owner_delivery_needs_review'};
 const result=journeyWork.status==='fulfilled'?journeyWork.value:{status:'journey_processing_needs_review'};
 const ownerFailed=['owner_delivery_needs_review','message_delivery_needs_review','messaging_configuration_required','business_number_verification_required','inbound_invitation_not_ready'].includes(ownerDelivery.status);
 return Response.json({...result,ownerDelivery,supervisor},{status:result.status==='journey_processing_needs_review'||ownerFailed||supervisor.errors>0?503:200,headers});
}
