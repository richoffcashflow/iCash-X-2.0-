import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {runOutcomeRanker} from '@/lib/outcome-ranker-service';
import {db} from '@/lib/stripe-test';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!authorizeOutboundBilling(request,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 try{return Response.json(await runOutcomeRanker(db,AbortSignal.any([request.signal,AbortSignal.timeout(45000)])),{headers});}
 catch{return Response.json({error:'Outcome training incomplete; existing ranking remains available.'},{status:503,headers});}
}
