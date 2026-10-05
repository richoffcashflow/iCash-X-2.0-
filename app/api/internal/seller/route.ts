import {db} from '@/lib/stripe-test';
import {authorizeOutboundBilling} from '@/lib/outbound-billing-service';
import {processSellerIntake} from '@/lib/seller-pipeline';
import {deliverSellerEvent} from '@/lib/seller-conversions';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:Request){
 const headers={'Cache-Control':'no-store'};
 if(!authorizeOutboundBilling(req,process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401,headers});
 try{
  const [controls]=await db<{enabled:boolean}[]>('icash_seller_controls?id=eq.1&select=enabled');
  if(!controls?.enabled)return Response.json({status:'seller_setup_required'},{headers});
  await db('rpc/icash_collect_seller_milestones','POST',{});
  const lookup=await processSellerIntake(db,process.env.DEALMACHINE_API_KEY);
  const allocation=await db('rpc/icash_assign_seller_lead','POST',{});
  const measurement=await deliverSellerEvent(db,process.env);
  return Response.json({lookup,allocation,measurement},{headers});
 }catch{return Response.json({status:'seller_processing_requires_review'},{status:503,headers});}
}
