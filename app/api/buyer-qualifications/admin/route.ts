import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireTrustedOperator} from '@/lib/trusted-operator';
import {db} from '@/lib/stripe-test';
import {buyerQualificationDecisionSchema,buyerQualificationError,type BuyerQualificationRow} from '@/lib/buyer-qualification';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  await requireTrustedOperator('authority_review');const page=z.coerce.number().int().min(0).max(10000).parse(new URL(req.url).searchParams.get('page')??0);
  const rows=await db<BuyerQualificationRow[]>(`icash_buyer_qualification_requests?select=*&order=created_at.desc,id.desc&limit=21&offset=${page*20}`);
  return NextResponse.json({requests:rows.slice(0,20),hasMore:rows.length>20,notice:'Only approve after personally reviewing current buyer criteria, source evidence, proof of funds and the named signatory’s authority. No external verification is performed by this form.'},{headers});
 }catch(error){const e=buyerQualificationError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function POST(req:Request){
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin operator session required.'},{status:403,headers});
  const {userId}=await requireTrustedOperator('authority_review');const raw=await req.text();if(raw.length>12000)return NextResponse.json({error:'Review too long.'},{status:413,headers});
  const input=buyerQualificationDecisionSchema.parse(JSON.parse(raw));
  if(input.decision==='approved'&&!input.verification)return NextResponse.json({error:'Your actual reviewed evidence is required.'},{status:400,headers});
  const request=await db<BuyerQualificationRow>('rpc/icash_decide_buyer_qualification','POST',{p_reviewer:userId,p_request:input.requestId,p_decision:input.decision,p_note:input.note,p_verification:input.verification??{}});
  return NextResponse.json({request,message:'Review recorded. No new contact permission was granted and no message was sent.'},{headers});
 }catch(error){const e=buyerQualificationError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
