import {recoverSupportAccount} from '@/lib/support-recovery';
import {scheduleSupportCustomerNotifications} from '@/lib/support-customer-dispatch';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
import {supportId,supportMessageInput,redactSupportQuestion} from '@/lib/support-policy';
import {collectSupportDiagnostics} from '@/lib/support-diagnostics';
import {replyToSupport,type SupportTurn} from '@/lib/support-conversation';
import {supportOwnerNotificationsEnabled} from '@/lib/support-owner-notifications';
import {scheduleSupportOwnerNotifications} from '@/lib/support-owner-dispatch';
import {refundEvidenceNeeded} from '@/lib/support-closure';
import {prepareSupportRefundEvidence} from '@/lib/support-refund-evidence';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount({allowInactiveMembership:true,allowUnacknowledged:true});const raw=new URL(req.url).searchParams.get('threadId');const threadId=raw?supportId.parse(raw):null;
  const threads=await db<{id:string;subject:string;status:string;updated_at:string}[]>(`icash_support_threads?account_id=eq.${accountId}&select=id,subject,status,updated_at&order=updated_at.desc&limit=30`);
  const chosen=threadId??threads[0]?.id;
  if(threadId&&!threads.some(t=>t.id===threadId)){
   const [linked]=await db<(typeof threads)[number][]>(`icash_support_threads?account_id=eq.${accountId}&id=eq.${threadId}&select=id,subject,status,updated_at&limit=1`);
   if(!linked)return NextResponse.json({error:'Conversation not found.'},{status:404,headers});threads.unshift(linked);
  }
  const mode=fundingMode();
  const [messages,cancellations]=await Promise.all([
   chosen?db(`icash_support_messages?account_id=eq.${accountId}&thread_id=eq.${chosen}&select=id,role,content,created_at&order=created_at.desc&limit=100`):[],
   mode?db(`icash_support_cancel_requests?account_id=eq.${accountId}&mode=eq.${mode}&select=id,source,state,result,created_at&order=created_at.desc&limit=5`):[],
  ]);
  return NextResponse.json({threads,threadId:chosen??null,messages:Array.isArray(messages)?messages.reverse():[],cancellations},{headers});
 }catch(e){return NextResponse.json({error:e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message)?'Sign in to your account to get help.':'Support history is unavailable. Please retry.'},{status:e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message)?401:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount({allowInactiveMembership:true,allowUnacknowledged:true});const raw=await req.text();if(raw.length>5000)return NextResponse.json({error:'Message too long.'},{status:413,headers});
  const value=JSON.parse(raw);
  if(value.action==='escalate'){
   z.object({action:z.literal('escalate'),threadId:supportId}).strict().parse(value);
   return NextResponse.json({error:'Support continues automatically in this chat. Send what is still happening so I can check it.'},{status:409,headers});
  }
  const i=supportMessageInput.parse(value);
  // Redact common credentials/contact details before durable storage and model use.
  const question=redactSupportQuestion(i.message);
  const started=await db<{threadId:string;replay?:boolean;response?:unknown;rateLimited?:boolean}>('rpc/icash_support_begin_message','POST',{p_account:accountId,p_user:userId,p_thread:i.threadId??null,p_request:i.requestId,p_message:question});
  if(started.rateLimited)return NextResponse.json({error:'Please wait a minute before sending more messages. The daily limit is 60 messages.'},{status:429,headers});
  if(started.replay&&started.response){
   scheduleSupportOwnerNotifications();scheduleSupportCustomerNotifications();
   return NextResponse.json({threadId:started.threadId,replay:true},{headers});
  }
  await recoverSupportAccount(accountId,userId).catch(()=>undefined);
  const [evidence,history,threads]=await Promise.all([
   collectSupportDiagnostics(accountId),
   db<SupportTurn[]>(`icash_support_messages?account_id=eq.${accountId}&thread_id=eq.${started.threadId}&select=role,content&order=created_at.desc,id.desc&limit=201`),
   db<{status:string}[]>(`icash_support_threads?account_id=eq.${accountId}&id=eq.${started.threadId}&select=status`)
  ]);
  const messages=history.reverse();
  if(messages.at(-1)?.content!==question||messages.at(-1)?.role!=='user')messages.push({role:'user',content:question});
  if(refundEvidenceNeeded(messages))evidence.push(await prepareSupportRefundEvidence(db,{accountId,threadId:started.threadId,requestId:i.requestId},evidence,fundingMode()));
  // Replayed receipts use the local answer; they never repeat a paid model call.
  const answer=await replyToSupport({kind:'account',messages,evidence,historyComplete:history.length<201,handedOff:threads[0]?.status==='escalated',allowAI:!started.replay});
  await db('rpc/icash_support_finish_conversation','POST',{p_account:accountId,p_user:userId,p_thread:started.threadId,p_request:i.requestId,p_message:answer.reply,p_evidence:evidence,p_status:answer.status,p_notify:supportOwnerNotificationsEnabled()});
  scheduleSupportOwnerNotifications();scheduleSupportCustomerNotifications();
  return NextResponse.json({threadId:started.threadId,ai:answer.ai},{headers});
 }catch(e){const auth=e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message);return NextResponse.json({error:auth?'Sign in to get help.':e instanceof z.ZodError||e instanceof SyntaxError?'Please check your message and try again.':'Could not confirm that the reply was saved. Refresh the conversation before retrying.'},{status:auth?401:e instanceof z.ZodError||e instanceof SyntaxError?400:503,headers});}
}
