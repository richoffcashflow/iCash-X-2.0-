import {db} from '@/lib/stripe-test';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {sendForSignatures} from '@/lib/signing-service';
import {textPendingContract} from '@/lib/contract-text-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {coordinateTitleOpening} from '@/lib/title-service';
import {processDealJourneys} from '@/lib/deal-journey-service';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function GET(req:Request){
 const headers={'Cache-Control':'no-store'};
 if(!authorizeOutboundBilling(req,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 try{return Response.json(await processDealJourneys({db,send:sendForSignatures,text:textPendingContract,dispatch:dispatchTextMessage,title:coordinateTitleOpening},process.env),{headers});}
 catch{return Response.json({status:'journey_processing_needs_review'},{status:503,headers});}
}
