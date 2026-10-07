import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {dealTermsSchema} from '@/lib/deal-documents';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount();const screeningId=z.string().uuid().parse(new URL(req.url).searchParams.get('screeningId'));
  const [contacts,deals]=await Promise.all([
   db<{phone:string;name:string;phone_type:string;blocked:boolean}[]>('rpc/icash_manual_contacts','POST',{p_account:accountId,p_screening:screeningId}),
   db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id&limit=1`)
  ]);
  const threads=deals[0]?await db<{id:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${deals[0].id}&retired_at=is.null&select=id&limit=1`):[];
  return NextResponse.json({contacts,dealId:threads.length?deals[0].id:null},{headers});
 }catch{return NextResponse.json({error:'Could not load contacts.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>512)throw Error();
  const {screeningId,phone}=z.object({screeningId:z.string().uuid(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/)}).strict().parse(JSON.parse(raw));
  const result=await db<{dealId?:string;threadId?:string;error?:string}>('rpc/icash_prepare_manual_text','POST',{p_actor:userId,p_account:accountId,p_screening:screeningId,p_phone:phone,p_terms:dealTermsSchema.parse({})});
  return NextResponse.json(result,{status:result.error?409:200,headers});
 }catch{return NextResponse.json({error:'Could not open this conversation. Try again.'},{status:409,headers});}
}
