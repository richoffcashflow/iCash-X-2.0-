import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {platformLearningReportSchema} from '@/lib/shared-learning';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 try{
  const user=await dashboardCurrentUser(true);
  if(!user)return Response.json({error:'Sign in to view platform learning.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Owner access only.'},{status:403,headers});
  const report=platformLearningReportSchema.parse(await db('rpc/icash_platform_learning_report','POST',{p_actor:user.id},req.signal));
  return Response.json({report},{headers});
 }catch{return Response.json({error:'Platform learning is temporarily unavailable.'},{status:503,headers});}
}
