import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>200)throw new Error();
  const {id}=z.object({id:z.string().uuid()}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_acknowledge_handoff','POST',{p_user:userId,p_account:accountId,p_id:id});
  return NextResponse.json({saved:true},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not acknowledge this request.'},{status:400});}
}
