import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId}=await workAccount();const raw=await req.text();if(raw.length>200)throw new Error();
  const {id}=z.object({id:z.string().uuid()}).strict().parse(JSON.parse(raw));
  const [request]=await db<{id:string}[]>(`icash_sms_call_requests?id=eq.${id}&account_id=eq.${accountId}&select=id`);
  if(!request)throw new Error();
  await db(`icash_sms_call_requests?id=eq.${id}&account_id=eq.${accountId}&state=eq.needs_review`,'PATCH',{state:'resolved',updated_at:new Date().toISOString()});
  return NextResponse.json({saved:true},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not update the call request.'},{status:400});}
}
