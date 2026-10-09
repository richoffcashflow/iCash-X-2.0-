import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!allowedOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId}=await workAccount();const raw=await request.text();if(raw.length>200)throw Error();
  const {id}=z.object({id:z.string().uuid()}).strict().parse(JSON.parse(raw));
  const [row]=await db<{id:string}[]>(`icash_buyer_viewing_requests?account_id=eq.${accountId}&id=eq.${id}&select=id`);if(!row)throw Error();
  await db(`icash_buyer_viewing_requests?account_id=eq.${accountId}&id=eq.${id}&state=eq.needs_confirmation`,'PATCH',{state:'reviewed',reviewed_at:new Date().toISOString()});
  return NextResponse.json({saved:true},{headers});
 }catch{return NextResponse.json({error:'Could not save your review.'},{status:409,headers});}
}
