import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {customerTextStatus} from '@/lib/customer-text-status';
import {threadConversationCalls} from '@/lib/thread-conversation-calls';
type Thread={id:string;recipient:string;paused:boolean;party:string};
type Message={id:string;created_at:string;state:string;direction:string;request_key:string|null;customer_author_id:string|null};
const messageFields='id,thread_id,direction,body,state,attachments,created_at,request_key,customer_author_id';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId,userId}=await workAccount();const params=new URL(req.url).searchParams;const dealId=z.guid().parse(params.get('dealId'));
 const afterThread=params.get('afterThread');if(afterThread)z.guid().parse(afterThread);
 const threadRows=await db<Thread[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&retired_at=is.null&select=id,recipient,paused,party&order=id.desc&limit=21${afterThread?`&id=lt.${afterThread}`:''}`);
 const threads=threadRows.slice(0,20);
 const preferred=!params.get('threadId')&&!afterThread?await db<string|null>('rpc/icash_latest_seller_text_thread','POST',{p_account:accountId,p_deal:dealId}):null;
 const threadId=params.get('threadId')?z.guid().parse(params.get('threadId')):preferred??(threads.find(t=>t.party==='seller')??threads[0])?.id;
 if(threadId&&!threads.some(t=>t.id===threadId)){
  const selected=await db<Thread[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&id=eq.${threadId}&retired_at=is.null&select=id,recipient,paused,party&limit=1`);
  if(selected.length!==1||selected[0].id!==threadId)throw Error();threads.push(selected[0]);
 }
 const summaries=threads.length?await db<{thread_id:string;preview:string;received_at:string;unread_count:number}[]>('rpc/icash_text_thread_reply_summaries','POST',{p_account:accountId,p_threads:threads.map(t=>t.id)}):[];
 const before=params.get('before');if(before)z.string().datetime({offset:true}).parse(before);const beforeId=before?z.guid().parse(params.get('beforeId')):null;
 const requestKey=params.get('requestKey');if(requestKey)z.guid().parse(requestKey);
 const [rows,receipts,firstRows]=threadId?await Promise.all([
 db<Message[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&select=${messageFields}&order=created_at.desc,id.desc&limit=21${before?`&or=(created_at.lt.${encodeURIComponent(before)},and(created_at.eq.${encodeURIComponent(before)},id.lt.${beforeId}))`:''}`),
 requestKey?db<{state:string;request_key:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&customer_author_id=eq.${userId}&request_key=eq.${requestKey}&select=state,request_key&limit=1`):Promise.resolve([]),
 db<Message[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&select=${messageFields}&order=created_at.asc,id.asc&limit=1`)
 ]):[[],[],[]];
 const present=({customer_author_id,request_key,...message}:Message)=>({...message,author:message.direction==='incoming'?'contact':customer_author_id?'you':'bot',retryKey:customer_author_id===userId&&message.state==='ready'?request_key:null});
 const messages=rows.slice(0,20).map(present),last=messages.at(-1),current=threads.find(t=>t.id===threadId);
 const callsResult=current&&params.get('includeCalls')==='true'?threadConversationCalls(db,accountId,{...current,dealId},before??null,rows.length>20&&last?last.created_at:null,process.env.ICASH_RECORDING_RECEIPTS_READY==='true'):Promise.resolve({calls:[],callsUnavailable:false});
 const sendReason=threadId?await db<string|null>('rpc/icash_manual_text_reason','POST',{p_account:accountId,p_thread:threadId}):null;
 return NextResponse.json({...await callsResult,threads:threads.map(t=>({...t,reply:summaries.find(s=>s.thread_id===t.id)??null,manualReply:true,sendReason:t.id===threadId?sendReason:null})),threadId,messages,firstMessage:firstRows[0]?present(firstRows[0]):null,receipt:requestKey?(receipts[0]??{state:'not_found',request_key:requestKey}):null,nextThread:threadRows.length>20?threadRows[19].id:null,next:rows.length>20&&last?{before:last.created_at,beforeId:last.id}:null},{headers});
 }catch{return NextResponse.json({error:'Messages unavailable'},{status:400,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>10000)throw Error();
 const b=z.object({threadId:z.guid(),requestKey:z.guid(),message:z.string().trim().max(1000),assetIds:z.array(z.guid()).max(3).default([])}).strict().parse(JSON.parse(raw));
 const queued=await db<{id:string;manual:boolean;error?:string}>('rpc/icash_queue_customer_text','POST',{p_actor:userId,p_account:accountId,p_thread:b.threadId,p_key:b.requestKey,p_body:b.message,p_assets:b.assetIds});
 if(queued.error)return NextResponse.json({error:queued.error,notSent:true},{status:409});
 let dispatched:{status:string}|undefined;
 try{dispatched=await dispatchTextMessage(accountId,queued.id,true);}catch{/* Reconcile a failed claim before allowing another submission. */}
 try{return NextResponse.json({...queued,...await customerTextStatus(accountId,queued.id,b.threadId,dispatched?.status)});}
 catch{return NextResponse.json({...queued,status:'message_delivery_needs_review'});}
 }catch{return NextResponse.json({error:'Could not queue this text. Refresh the conversation and try again.'},{status:409});}
}
