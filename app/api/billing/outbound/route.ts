import {db} from '@/lib/stripe-test';
import {reconcileLiveConversation} from '@/lib/live-conversation-service';
import {authorizeOutboundBilling,runOutboundBilling} from '@/lib/outbound-billing-service';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!authorizeOutboundBilling(request,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 try{return Response.json(await runOutboundBilling(process.env.OUTBOUND_USAGE_BILLING_ENABLED==='true',db,reconcileLiveConversation),{headers});}
 catch{return Response.json({status:'billing_attempt_unconfirmed'},{status:503,headers});}
}
