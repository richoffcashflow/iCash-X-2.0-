import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {authorityError} from '@/lib/action-authority';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{
 const {accountId}=await workAccount(),params=new URL(req.url).searchParams;
 const screeningId=params.has('screeningId')?z.string().uuid().parse(params.get('screeningId')):null;
 if(screeningId){
 const [deal]=await db<{id:string;terms:{priceCents:number|null;assignmentFeeCents:number|null;state:string}}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,terms`);
 const envelopes=deal?await db<{id:string;terms_hash:string}[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=eq.${deal.id}&kind=eq.purchase&state=eq.completed&test_mode=eq.false&select=id,terms_hash`):[];
 const buyers=deal?await db<{buyerId:string;name:string}[]>('rpc/icash_buyer_qualification_options','POST',{p_account:accountId,p_deal:deal.id}):[];
 return NextResponse.json({buyers:buyers.map(b=>({id:b.buyerId,name:b.name})),marketing:deal&&envelopes[0]?{dealId:deal.id,purchaseEnvelopeId:envelopes[0].id,termsHash:envelopes[0].terms_hash,stateCode:deal.terms.state,maxCents:Number.isSafeInteger(deal.terms.priceCents)&&Number.isSafeInteger(deal.terms.assignmentFeeCents)?deal.terms.priceCents!+deal.terms.assignmentFeeCents!:null}:null},{headers});
 }
 const page=z.coerce.number().int().min(0).max(10000).parse(params.get('page')??0);
 const query=z.string().trim().max(100).regex(/^[a-zA-Z0-9 .,#'/-]*$/).parse(params.get('query')??'');
 const rows=await db<{id:string;result:{property:{address:string}}}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.complete&select=id,result:result->property&order=completed_at.desc,id.desc&limit=21&offset=${page*20}${query?`&result->property->>address=ilike.*${encodeURIComponent(query)}*`:''}`);
 return NextResponse.json({properties:rows.slice(0,20).map(row=>({id:row.id,address:(row.result as unknown as {address:string})?.address||'Reviewed property'})),hasMore:rows.length>20},{headers});
 }catch(error){const e=authorityError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
