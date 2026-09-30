import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {buyerQualificationSubmitSchema,validateBuyerQualificationTimes,buyerQualificationView,buyerQualificationError,type BuyerQualificationRow} from '@/lib/buyer-qualification';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount(),params=new URL(req.url).searchParams;
  const dealId=z.string().uuid().parse(params.get('dealId')),page=z.coerce.number().int().min(0).max(10000).parse(params.get('page')??0);
  const [deal]=await db<{id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=id`);
  if(!deal)return NextResponse.json({error:'Deal not found.'},{status:404,headers});
  const [requests,candidates]=await Promise.all([
   db<BuyerQualificationRow[]>(`icash_buyer_qualification_requests?account_id=eq.${accountId}&deal_id=eq.${dealId}&select=*&order=created_at.desc,id.desc&limit=21&offset=${page*20}`),
   db<{buyerId:string;name:string;entityKey:string;qualificationState:string;expiresAt:string|null}[]>('rpc/icash_buyer_qualification_options','POST',{p_account:accountId,p_deal:dealId}),
  ]);
  return NextResponse.json({requests:requests.slice(0,20).map(r=>buyerQualificationView(r)),candidates,hasMore:requests.length>20,notice:'Use evidence references, not account numbers or bank documents. Buyer claims are unverified; review does not grant contact permission.'},{headers});
 }catch(error){const e=buyerQualificationError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function POST(req:Request){
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin account session required.'},{status:403,headers});
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>14000)return NextResponse.json({error:'Buyer review is too long.'},{status:413,headers});
  const input=buyerQualificationSubmitSchema.parse(JSON.parse(raw));validateBuyerQualificationTimes(input.payload);
  const row=await db<BuyerQualificationRow>('rpc/icash_submit_buyer_qualification','POST',{p_account:accountId,p_user:userId,p_key:input.idempotencyKey,p_payload:input.payload});
  return NextResponse.json({request:buyerQualificationView(row),message:'Buyer statements saved for human review. No funds, signing authority or contact permission was verified.'},{status:201,headers});
 }catch(error){const e=buyerQualificationError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function DELETE(req:Request){
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin account session required.'},{status:403,headers});
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>1000)return NextResponse.json({error:'Request too long.'},{status:413,headers});
  const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_withdraw_buyer_qualification','POST',{p_account:accountId,p_user:userId,p_request:requestId});
  return NextResponse.json({message:'Buyer review withdrawn. Its qualification can no longer authorize a ready buyer match.'},{headers});
 }catch(error){const e=buyerQualificationError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
