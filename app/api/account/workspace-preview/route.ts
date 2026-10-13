import {NextResponse} from 'next/server';
import {z} from 'zod';
import {dashboardWorkAccount as workAccount} from '@/lib/dashboard-password';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const raw=await req.text();if(raw.length>100)throw Error('Invalid preview');
  const {mode}=z.object({mode:z.enum(['standard','vip']).nullable()}).strict().parse(JSON.parse(raw));
  const {accountId,userId}=await workAccount({allowInactiveMembership:mode===null});
  if(userId!==ownerInboundTarget.ownerUserId)return NextResponse.json({error:'Admin access required.'},{status:403,headers});
  await db('rpc/icash_set_workspace_preview','POST',{p_account:accountId,p_user:userId,p_mode:mode});
  return NextResponse.json({saved:true},{headers});
 }catch{return NextResponse.json({error:'Could not change the preview. Refresh and try again.'},{status:409,headers});}
}
