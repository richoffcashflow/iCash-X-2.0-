import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {usageLoopReportSchema} from '@/lib/usage-loop-tracking';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function GET(req:Request){
 try{
  const user=await dashboardCurrentUser(true);
  if(!user)return Response.json({error:'Sign in to view this report.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Owner access only.'},{status:403,headers});
  const include=new URL(req.url).searchParams.get('includeOwner')??'false';
  if(!['true','false'].includes(include))return Response.json({error:'Invalid report option.'},{status:400,headers});
  const report=usageLoopReportSchema.parse(await db('rpc/icash_usage_loop_report','POST',{p_actor:user.id,p_include_owner:include==='true'},req.signal));
  return Response.json({report},{headers});
 }catch{return Response.json({error:'Usage progress report is temporarily unavailable.'},{status:503,headers});}
}
