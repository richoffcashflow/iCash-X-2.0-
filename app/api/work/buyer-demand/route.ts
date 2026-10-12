import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();
  if(!await db<boolean>('rpc/icash_vip_features_active','POST',{p_account:accountId}))return Response.json({error:'An active VIP membership is required.'},{status:403,headers});
  return Response.json(await db('rpc/icash_network_demand','POST',{p_account:accountId}),{headers});
 }catch{return Response.json({error:'Could not load current buyer demand.'},{status:503,headers});}
}
