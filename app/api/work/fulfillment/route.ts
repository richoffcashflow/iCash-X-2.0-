import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
 const {accountId}=await workAccount();const dealId=new URL(req.url).searchParams.get('dealId');if(!dealId||!/^[a-f0-9-]{36}$/i.test(dealId))return NextResponse.json({error:'Choose a deal.'},{status:400});
 const [deal]=await db<{id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=id`);if(!deal)return NextResponse.json({error:'Deal not found.'},{status:404});
 const [job]=await db<{id:string;state:string;result:unknown;updated_at:string}[]>(`icash_fulfillment_jobs?deal_id=eq.${deal.id}&account_id=eq.${accountId}&select=id,state,result,updated_at`);
 const documents=job?await db<unknown[]>(`icash_deal_documents?deal_id=eq.${deal.id}&fulfillment_job_id=eq.${job.id}&select=id,kind,html&limit=2`):[];
 const matches=await db<{buyer_id:string;rank:number;ready:boolean}[]>(`icash_buyer_matches?deal_id=eq.${deal.id}&select=buyer_id,rank,ready&order=rank&limit=50`);
 const ids=matches.map(m=>m.buyer_id).join(',');
 const buyers=ids?await db<{id:string;display_name:string}[]>(`icash_buyer_profiles?account_id=eq.${accountId}&id=in.(${ids})&select=id,display_name`):[];
 const candidates=await db<{buyer_id:string;discovered_at:string}[]>(`icash_buyer_candidates?deal_id=eq.${deal.id}&rights_until=gt.${new Date().toISOString()}&select=buyer_id,discovered_at&order=discovered_at.desc&limit=50`);
 const candidateIds=candidates.map(c=>c.buyer_id).join(',');
 const candidateNames=candidateIds?await db<{id:string;display_name:string}[]>(`icash_buyer_profiles?account_id=eq.${accountId}&id=in.(${candidateIds})&select=id,display_name`):[];
 const [title]=await db<{state:string}[]>(`icash_title_requests?account_id=eq.${accountId}&deal_id=eq.${deal.id}&select=state`);
 const [titleContact]=await db<{email:string}[]>(`icash_title_contacts?account_id=eq.${accountId}&deal_id=eq.${deal.id}&enabled=eq.true&verified_until=gt.${new Date().toISOString()}&select=email`);
 const titleReplies=await db<{id:string;sender:string;subject:string;body_text:string;received_at:string;needs_review:boolean}[]>(`icash_title_replies?account_id=eq.${accountId}&deal_id=eq.${deal.id}&sender_verified=eq.true&select=id,sender,subject,body_text,received_at,needs_review&order=received_at.desc&limit=10`);
 return NextResponse.json({titleReplies,title:title?.state??null,titleReady:!!titleContact&&!!process.env.RESEND_API_KEY&&!!process.env.ICASH_TITLE_FROM_EMAIL&&!!process.env.ICASH_TITLE_REPLY_EMAIL,candidates:candidateNames.map(c=>({id:c.id,name:c.display_name})),job,documents,buyers:matches.map(m=>({...m,name:buyers.find(b=>b.id===m.buyer_id)?.display_name??'Buyer'}))},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not load deal progress.'},{status:503});}
}
