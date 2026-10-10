import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await request.text();if(raw.length>1500)throw Error();
  const {id,action,note}=z.object({id:z.string().uuid(),action:z.enum(['acknowledge','resolve']).default('acknowledge'),note:z.string().trim().max(1000).default('')}).strict().parse(JSON.parse(raw));
  if(!await db<boolean>('rpc/icash_update_buyer_request','POST',{p_account:accountId,p_actor:userId,p_request:id,p_action:action,p_note:note}))throw Error();
  return NextResponse.json({saved:true},{headers});
 }catch{return NextResponse.json({error:'Could not save your review.'},{status:409,headers});}
}
