import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{
  const {accountId,userId}=await workAccount();
  const raw=await req.text();if(raw.length>1500)throw Error('Invalid read');
  const input=z.object({threadId:z.guid(),messageIds:z.array(z.guid()).min(1).max(20)}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_mark_text_messages_read','POST',{p_account:accountId,p_user:userId,p_thread:input.threadId,p_messages:input.messageIds});
  return NextResponse.json({saved:true},{headers});
 }catch{return NextResponse.json({error:'Could not save read status.'},{status:400,headers});}
}
