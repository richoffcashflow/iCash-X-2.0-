import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
 try{
  const {accountId}=await workAccount();
  const gaps=await db(`icash_seller_gaps?account_id=eq.${accountId}&state=in.(open,queued,waiting,needs_review)&select=id,deal_id,reason,stage,channel,quote,state,due_at,updated_at&order=updated_at.desc,id&limit=100`);
  return NextResponse.json({gaps},{headers});
 }catch{return NextResponse.json({error:'Could not load seller follow-ups.'},{status:400,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>6000)throw Error('Invalid request');
  const input=z.object({id:z.string().uuid(),version:z.string().datetime({offset:true}),resolution:z.string().trim().min(10).max(2000)}).strict().parse(JSON.parse(raw));
  const saved=await db<boolean>('rpc/icash_review_seller_gap','POST',{p_account:accountId,p_actor:userId,p_gap:input.id,p_version:input.version,p_resolution:input.resolution});
  return NextResponse.json(saved?{saved:true}:{error:'The seller case changed. Refresh before resolving it.'},{status:saved?200:409,headers});
 }catch{return NextResponse.json({error:'Could not resolve this seller follow-up.'},{status:400,headers});}
}
