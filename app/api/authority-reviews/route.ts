import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {authoritySubmitSchema,validateAuthorityTimes,customerAuthorityReview,authorityError,type AuthorityReviewRow} from '@/lib/action-authority';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
 const {accountId}=await workAccount(),params=new URL(req.url).searchParams;
 const page=z.coerce.number().int().min(0).max(10000).parse(params.get('page')??0);
 const screeningId=params.has('screeningId')?z.string().uuid().parse(params.get('screeningId')):null;
 const rows=await db<AuthorityReviewRow[]>(`icash_authority_review_requests?account_id=eq.${accountId}${screeningId?`&screening_id=eq.${screeningId}`:''}&select=id,kind,screening_id,state,expires_at,created_at,decision_note,payload&order=created_at.desc,id.desc&limit=21&offset=${page*20}`);
 return NextResponse.json({requests:rows.slice(0,20).map(customerAuthorityReview),hasMore:rows.length>20,notice:'Submitting evidence does not authorize outreach, an offer or marketing. No external do-not-call check is performed by this form.'},{headers});
 }catch(error){const e=authorityError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function POST(req:Request){
 try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Open the review form from your account.'},{status:403,headers});
 const {accountId,userId}=await workAccount();
 const raw=await req.text();if(raw.length>12000)return NextResponse.json({error:'Review details are too long.'},{status:413,headers});
 const input=authoritySubmitSchema.parse(JSON.parse(raw));validateAuthorityTimes(input.payload);
 const row=await db<AuthorityReviewRow>('rpc/icash_submit_authority_review','POST',{p_account:accountId,p_user:userId,p_key:input.idempotencyKey,p_payload:input.payload});
 return NextResponse.json({request:customerAuthorityReview(row),message:'Saved for review. No permission was granted.'},{status:201,headers});
 }catch(error){const e=authorityError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function DELETE(req:Request){
 try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin session required.'},{status:403,headers});
 const {accountId,userId}=await workAccount();const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(await req.json());
 await db('rpc/icash_withdraw_authority_review','POST',{p_account:accountId,p_user:userId,p_request:requestId});
 return NextResponse.json({message:'Request withdrawn. Any authority issued from it has been revoked.'},{headers});
 }catch(error){const e=authorityError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
