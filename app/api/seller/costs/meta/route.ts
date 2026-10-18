import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {listMetaCostAccounts,listMetaCostCampaigns,MetaCostError} from '@/lib/seller-meta-costs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const user=await dashboardCurrentUser(true);if(user?.id!==ownerInboundTarget.ownerUserId)return Response.json({error:'Platform owner access required.'},{status:403,headers});
  const account=new URL(req.url).searchParams.get('account');
  return Response.json(account?{campaigns:await listMetaCostCampaigns(account,process.env)}:{accounts:await listMetaCostAccounts(process.env)},{headers});
 }catch(e){return Response.json({error:e instanceof MetaCostError?e.message:'Meta connection could not be checked.'},{status:503,headers});}
}
