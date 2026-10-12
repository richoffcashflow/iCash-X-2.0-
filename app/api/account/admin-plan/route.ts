import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const raw=await req.text();if(raw.length>100)throw Error('Invalid plan');
  const {plan}=z.object({plan:z.enum(['standard','vip'])}).strict().parse(JSON.parse(raw));
  const {accountId,userId}=await workAccount();
  if(userId!==ownerInboundTarget.ownerUserId)return NextResponse.json({error:'Admin access required.'},{status:403,headers});
  await db('rpc/icash_set_admin_plan','POST',{p_account:accountId,p_user:userId,p_plan:plan});
  return NextResponse.json({saved:true,plan},{headers});
 }catch{return NextResponse.json({error:'Could not switch your account plan. Refresh and try again.'},{status:409,headers});}
}
