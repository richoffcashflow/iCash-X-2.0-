import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {requireTrustedOperator} from '@/lib/trusted-operator';
import {db} from '@/lib/stripe-test';
import {completedSigningPdf} from '@/lib/signing-service';
import {signingTermsHash} from '@/lib/signing-policy';
import {authorityDecisionSchema,authorityError,type AuthorityReviewRow} from '@/lib/action-authority';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
 await requireTrustedOperator('authority_review');const page=z.coerce.number().int().min(0).max(10000).parse(new URL(req.url).searchParams.get('page')??0);
 const requests=await db<AuthorityReviewRow[]>(`icash_authority_review_requests?select=*&order=created_at.desc,id.desc&limit=21&offset=${page*20}`);
 return NextResponse.json({requests:requests.slice(0,20),hasMore:requests.length>20,notice:'Approval requires actual reviewed evidence. No DNC source, operator or legal-market review is provisioned by the application.'},{headers});
 }catch(error){const e=authorityError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function POST(req:Request){
 try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin operator session required.'},{status:403,headers});
 const {userId}=await requireTrustedOperator('authority_review');const raw=await req.text();if(raw.length>16000)return NextResponse.json({error:'Review too long.'},{status:413,headers});
 const input=authorityDecisionSchema.parse(JSON.parse(raw));
 if(input.decision==='approved'&&!input.verification)return NextResponse.json({error:'Reviewed evidence is required.'},{status:400,headers});
 let verification:Record<string,unknown>=input.verification??{};
 // The browser never supplies the signed PDF hash. Re-verify provider signatures
 // and hash the actual combined PDF before the atomic SQL approval.
 if(input.decision==='approved'){
 const [request]=await db<(AuthorityReviewRow&{account_id:string})[]>(`icash_authority_review_requests?id=eq.${input.requestId}&select=*`);
 if(!request)return NextResponse.json({error:'Review not found.'},{status:404,headers});
 if(request.payload.kind==='contact_permission'&&request.payload.channel==='sms'){
 const sender=process.env.CONTIGUITY_FROM;if(!sender||!/^\+1[2-9][0-9]{9}$/.test(sender))throw Error('SMS_SENDER_REQUIRED');
 verification={...verification,smsSender:sender};
 }
 if(request.payload.kind==='marketing_release'){
 const payload=request.payload;
 const [envelope]=await db<{terms:unknown;terms_hash:string}[]>(`icash_signing_envelopes?id=eq.${payload.purchaseEnvelopeId}&account_id=eq.${request.account_id}&deal_id=eq.${payload.dealId}&select=terms,terms_hash`);
 if(!envelope||signingTermsHash(envelope.terms)!==payload.termsHash||envelope.terms_hash!==payload.termsHash)throw Error('CONTRACT_CHANGED');
 const pdf=await completedSigningPdf(request.account_id,payload.purchaseEnvelopeId);
 verification={...verification,signedDocumentHash:createHash('sha256').update(Buffer.from(pdf)).digest('hex'),signedDocumentCheckedAt:new Date().toISOString()};
 }
 }
 const row=await db<AuthorityReviewRow>('rpc/icash_decide_authority_review','POST',{p_reviewer:userId,p_request:input.requestId,p_decision:input.decision,p_note:input.note,p_verification:verification});
 return NextResponse.json({request:row,message:'Review decision saved. This did not dispatch outreach or send an offer.'},{headers});
 }catch(error){const e=authorityError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
