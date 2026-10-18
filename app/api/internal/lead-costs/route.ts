import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {db} from '@/lib/stripe-test';
import {syncSellerMetaCosts} from '@/lib/seller-meta-costs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:Request){
 const headers={'Cache-Control':'no-store'};
 if(!authorizeOutboundBilling(req,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 try{return Response.json({results:await Promise.all(Array.from({length:5},()=>syncSellerMetaCosts(db,process.env)))},{headers});}
 catch{return Response.json({status:'cost_sync_unavailable'},{status:503,headers});}
}
