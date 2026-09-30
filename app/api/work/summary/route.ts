import {customerFundingReady} from "@/lib/launch-readiness";
import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {summaryExplanation,type WorkSummary} from '@/lib/work-summary';
import {workSummaryPdf} from '@/lib/work-summary-pdf';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId}=await workAccount();const summary=await db<WorkSummary|null>('rpc/icash_work_summary','POST',{p_account:accountId});if(!summary)throw new Error();
 if(new URL(req.url).searchParams.get('format')==='pdf'){const bytes=await workSummaryPdf(summary);return new Response(Buffer.from(bytes),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="icash-work-summary.pdf"'}});}
 const packs=await db<{code:string;price_cents:number;enabled:boolean}[]>('icash_credit_packs?price_cents=gte.2000&select=code,price_cents,enabled&order=price_cents&limit=10');
 return NextResponse.json({...summary,explanation:summaryExplanation(summary),canFund:await customerFundingReady(),packs},{headers});
 }catch{return NextResponse.json({error:'Could not load your summary. Sign in and retry.'},{status:503,headers});}
}
