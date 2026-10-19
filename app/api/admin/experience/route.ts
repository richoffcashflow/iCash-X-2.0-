import {dashboardCurrentUser as currentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {workspaceExperienceSummarySchema} from '@/lib/workspace-experience';
import {reliabilityAlertStatusSchema} from '@/lib/reliability-alerts';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};

export async function GET(req:Request){
 try{
  const user=await currentUser(true);
  if(!user)return Response.json({error:'Sign in to view workspace monitoring.'},{status:401,headers});
  if(user.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Workspace monitoring is only available to the platform owner.'},{status:403,headers});
  const [experience,alerts]=await Promise.all([
   db<unknown>('rpc/icash_workspace_experience_summary','POST',{p_actor:user.id},req.signal),
   db<unknown>('rpc/icash_reliability_alert_status_v2','POST',{p_actor:user.id},req.signal),
  ]);
  return Response.json({experience:workspaceExperienceSummarySchema.parse(experience),alerts:reliabilityAlertStatusSchema.parse(alerts)},{headers});
 }catch{
  return Response.json({error:'Workspace monitoring could not load. Try again in a moment.'},{status:503,headers});
 }
}
