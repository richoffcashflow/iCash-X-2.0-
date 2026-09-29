import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dispatchTextMessage} from '@/lib/text-message-service';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{const {accountId}=await workAccount();const dealId=z.string().uuid().parse(new URL(req.url).searchParams.get('dealId'));
 const threads=await db<{id:string;recipient:string;paused:boolean}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&select=id,recipient,paused&limit=20`);
 const ids=threads.map(t=>t.id).join(',');
 const messages=ids?await db<unknown[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=in.(${ids})&select=id,thread_id,direction,body,state,attachments,created_at&order=created_at.desc&limit=100`):[];
 const ai=ids?await db<unknown[]>(`icash_text_ai_jobs?account_id=eq.${accountId}&thread_id=in.(${ids})&state=in.(drafted,handoff,needs_review)&select=id,thread_id,state,reply,analysis,created_at&order=created_at.desc&limit=20`):[];
 return NextResponse.json({threads,messages,ai},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Messages unavailable'},{status:400});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{const {accountId}=await workAccount();const raw=await req.text();if(raw.length>10000)throw Error();
 const b=z.object({threadId:z.string().uuid(),requestKey:z.string().uuid(),message:z.string().trim().max(1000),assetIds:z.array(z.string().uuid()).max(3).default([])}).strict().parse(JSON.parse(raw));
 const id=await db<string>('rpc/icash_queue_text','POST',{p_account:accountId,p_thread:b.threadId,p_key:b.requestKey,p_body:b.message,p_assets:b.assetIds});
 return NextResponse.json({id,...await dispatchTextMessage(accountId,id)});
 }catch{return NextResponse.json({error:'Message held. Check permission, message length, budget and sender setup.'},{status:409});}
}
