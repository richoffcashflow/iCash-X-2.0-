import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import type {ClosingSetupRecord,ClosingDirectoryOption} from '@/lib/closing-setup';
import type {ClosingUpdate} from '@/lib/closing-progress';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
 const {accountId}=await workAccount();const dealId=new URL(req.url).searchParams.get('dealId');if(!dealId||!/^[a-f0-9-]{36}$/i.test(dealId))return NextResponse.json({error:'Choose a deal.'},{status:400});
 const [deal]=await db<{id:string;terms:{state?:string;titleEmail?:string}}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=id,terms`);if(!deal)return NextResponse.json({error:'Deal not found.'},{status:404});
 const [jobs,matches,candidates,titles,titleContacts,titleReplies,titleTasks,closingUpdates,closingSetups,titleDirectory,buyerTitleSuggestions]=await Promise.all([
 db<{id:string;state:string;result:unknown;updated_at:string}[]>(`icash_fulfillment_jobs?deal_id=eq.${deal.id}&account_id=eq.${accountId}&select=id,state,result,updated_at`),
 db<{buyer_id:string;rank:number;ready:boolean}[]>(`icash_buyer_matches?deal_id=eq.${deal.id}&select=buyer_id,rank,ready&order=rank&limit=50`),
 db<{buyer_id:string;discovered_at:string}[]>(`icash_buyer_candidates?deal_id=eq.${deal.id}&rights_until=gt.${new Date().toISOString()}&select=buyer_id,discovered_at&order=discovered_at.desc&limit=50`),
 db<{state:string}[]>(`icash_title_requests?account_id=eq.${accountId}&deal_id=eq.${deal.id}&select=state`),
 db<{email:string;evidence_ref:string}[]>(`icash_title_contacts?account_id=eq.${accountId}&deal_id=eq.${deal.id}&enabled=eq.true&verified_until=gt.${new Date().toISOString()}&select=email,evidence_ref`),
 db<{id:string;sender:string;subject:string;body_text:string;received_at:string;needs_review:boolean}[]>(`icash_title_replies?account_id=eq.${accountId}&deal_id=eq.${deal.id}&sender_verified=eq.true&select=id,sender,subject,body_text,received_at,needs_review&order=received_at.desc&limit=10`),
 db<unknown[]>(`icash_title_tasks?account_id=eq.${accountId}&deal_id=eq.${deal.id}&state=in.(scheduled,needs_review)&select=id,kind,label,due_date,state,evidence,email_state&order=due_date.asc.nullsfirst,created_at&limit=50`),
 db<ClosingUpdate[]>(`icash_closing_updates?account_id=eq.${accountId}&deal_id=eq.${deal.id}&select=id,kind,effective_date,amount_cents,file_reference,reply_id,created_at&order=created_at.desc&limit=100`),
 db<ClosingSetupRecord[]>(`icash_closing_setup?account_id=eq.${accountId}&deal_id=eq.${deal.id}&select=id,deal_id,screening_id,payout,title_proposal,state,review_reason,updated_at&limit=1`),
 /^[A-Z]{2}$/.test(deal.terms.state??'')?db<ClosingDirectoryOption[]>(`icash_title_directory?claimed_states=cs.{${deal.terms.state}}&status=neq.rejected&contact_checked_until=gt.${new Date().toISOString()}&select=id,name,source_url,public_phone,public_email,status&order=status.desc,name&limit=3`):Promise.resolve([]),
 db<{id:string;title_quote:string}[]>(`icash_buyer_viewing_requests?account_id=eq.${accountId}&deal_id=eq.${deal.id}&title_quote=not.is.null&select=id,title_quote&order=created_at.desc&limit=3`)
 ]);
 const job=jobs[0],title=titles[0],titleContact=titleContacts.find(c=>deal.terms.titleEmail?.trim()?c.email.toLowerCase()===deal.terms.titleEmail.toLowerCase():c.evidence_ref.startsWith('owner-closing-verification:')),ids=matches.map(m=>m.buyer_id).join(','),candidateIds=candidates.map(c=>c.buyer_id).join(',');
 const [documents,buyers,candidateNames,packageData,packageLinks]=await Promise.all([
 job?db<unknown[]>(`icash_deal_documents?deal_id=eq.${deal.id}&fulfillment_job_id=eq.${job.id}&select=id,kind&limit=2`):Promise.resolve([]),
 ids?db<{id:string;display_name:string}[]>(`icash_buyer_profiles?account_id=eq.${accountId}&id=in.(${ids})&select=id,display_name`):Promise.resolve([]),
 candidateIds?db<{id:string;display_name:string}[]>(`icash_buyer_profiles?account_id=eq.${accountId}&id=in.(${candidateIds})&select=id,display_name`):Promise.resolve([]),
 db<{askingPriceCents:number;purchasePriceCents:number;assignmentFeeCents:number}|null>('rpc/icash_buyer_package_data','POST',{p_account:accountId,p_deal:deal.id}),
 db<{token:string;asking_price_cents:number}[]>(`icash_buyer_package_links?account_id=eq.${accountId}&deal_id=eq.${deal.id}&revoked_at=is.null&select=token,asking_price_cents&limit=1`)
 ]);
 const link=packageLinks[0];
 const buyerPackage=packageData&&link?.asking_price_cents===packageData.askingPriceCents?{...packageData,url:`https://www.geticashx.com/d/${link.token}`}:null;
 return NextResponse.json({closingSetup:{setup:closingSetups[0]??null,verifiedContact:titleContact?{email:titleContact.email}:null,directory:titleDirectory,buyerSuggestions:buyerTitleSuggestions,titleEmailInAgreement:deal.terms.titleEmail??null},buyerPackage,closingUpdates,titleTasks,titleReplies,title:title?.state??null,titleReady:!!titleContact&&!!process.env.RESEND_API_KEY&&!!process.env.RESEND_RECEIVING_WEBHOOK_SECRET&&!!process.env.ICASH_TITLE_FROM_EMAIL&&!!process.env.ICASH_TITLE_REPLY_EMAIL,candidates:candidateNames.map(c=>({id:c.id,name:c.display_name})),job,documents,buyers:matches.map(m=>({...m,name:buyers.find(b=>b.id===m.buyer_id)?.display_name??'Buyer'}))},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not load deal progress.'},{status:503});}
}
