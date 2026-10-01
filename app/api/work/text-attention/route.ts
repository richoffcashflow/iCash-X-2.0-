import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{
  const {accountId}=await workAccount();const raw=await req.text();if(raw.length>200)throw Error();
  const {id,messageId}=z.object({id:z.string().uuid(),messageId:z.string().uuid()}).strict().parse(JSON.parse(raw));
  const changed=await db<{id:string}[]>(`icash_text_attention?id=eq.${id}&account_id=eq.${accountId}&message_id=eq.${messageId}&select=id`,'PATCH',{state:'acknowledged',updated_at:new Date().toISOString()});
  if(changed.length!==1)return NextResponse.json({error:'This request changed. Refresh to review the latest message before marking it seen.'},{status:409,headers:{'Cache-Control':'private, no-store'}});
  return NextResponse.json({saved:true},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not acknowledge this request.'},{status:400});}
}
