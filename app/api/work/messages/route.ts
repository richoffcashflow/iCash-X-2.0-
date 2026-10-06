import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dispatchTextMessage} from '@/lib/text-message-service';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId}=await workAccount();const params=new URL(req.url).searchParams;const dealId=z.string().uuid().parse(params.get('dealId'));
 const afterThread=params.get('afterThread');if(afterThread)z.string().uuid().parse(afterThread);
 const threadRows=await db<{id:string;recipient:string;paused:boolean;party:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&select=id,recipient,paused,party&order=id.desc&limit=21${afterThread?`&id=lt.${afterThread}`:''}`);
 const threads=threadRows.slice(0,20);
 const threadId=params.get('threadId')?z.string().uuid().parse(params.get('threadId')):threads[0]?.id;
 if(threadId&&!threads.some(t=>t.id===threadId))throw Error();
 const before=params.get('before');if(before)z.string().datetime({offset:true}).parse(before);const beforeId=before?z.string().uuid().parse(params.get('beforeId')):null;
 const [rows,ai]=threadId?await Promise.all([
 db<{id:string;created_at:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&select=id,thread_id,direction,body,state,attachments,created_at&order=created_at.desc,id.desc&limit=21${before?`&or=(created_at.lt.${encodeURIComponent(before)},and(created_at.eq.${encodeURIComponent(before)},id.lt.${beforeId}))`:''}`),
 db<unknown[]>(`icash_text_ai_jobs?account_id=eq.${accountId}&thread_id=eq.${threadId}&state=in.(drafted,handoff,needs_review)&select=id,thread_id,state,reply,analysis,created_at&order=created_at.desc&limit=1`)
 ]):[[],[]];
 const messages=rows.slice(0,20),last=messages.at(-1);
 const sendReason=threadId?await db<string|null>('rpc/icash_manual_text_reason','POST',{p_account:accountId,p_thread:threadId}):null;
 return NextResponse.json({threads:threads.map(t=>({...t,manualReply:true,sendReason:t.id===threadId?sendReason:null})),threadId,messages,ai,nextThread:threadRows.length>20?threads.at(-1)!.id:null,next:rows.length>20&&last?{before:last.created_at,beforeId:last.id}:null},{headers});
 }catch{return NextResponse.json({error:'Messages unavailable'},{status:400,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>10000)throw Error();
 const b=z.object({threadId:z.string().uuid(),requestKey:z.string().uuid(),message:z.string().trim().max(1000),assetIds:z.array(z.string().uuid()).max(3).default([])}).strict().parse(JSON.parse(raw));
 const queued=await db<{id:string;manual:boolean;error?:string}>('rpc/icash_queue_customer_text','POST',{p_actor:userId,p_account:accountId,p_thread:b.threadId,p_key:b.requestKey,p_body:b.message,p_assets:b.assetIds});
 if(queued.error)return NextResponse.json({error:queued.error,notSent:true},{status:409});
 try{return NextResponse.json({...queued,...await dispatchTextMessage(accountId,queued.id,true)});}
 catch{return NextResponse.json({...queued,status:'message_delivery_needs_review'});}
 }catch{return NextResponse.json({error:'Could not queue this text. Refresh the conversation and try again.'},{status:409});}
}
