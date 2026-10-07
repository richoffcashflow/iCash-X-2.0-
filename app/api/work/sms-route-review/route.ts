import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>300)throw Error();
  const {messageId,revision}=z.object({messageId:z.string().uuid(),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict().parse(JSON.parse(raw));
  const saved=await db<boolean>('rpc/icash_review_sms_route','POST',{p_account:accountId,p_actor:userId,p_message:messageId,p_revision:revision});
  if(saved!==true)return NextResponse.json({error:'The conversation changed. Refresh and review the latest messages first.'},{status:409,headers});
  return NextResponse.json({saved:true},{headers});
 }catch{return NextResponse.json({error:'Could not save this review. Refresh and try again.'},{status:400,headers});}
}
