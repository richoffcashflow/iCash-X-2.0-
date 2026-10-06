import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
import {supportId,supportMessageInput,supportAnswer,redactSupportQuestion} from '@/lib/support-policy';
import {collectSupportDiagnostics} from '@/lib/support-diagnostics';
import {classifySupportQuestion} from '@/lib/support-ai';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount({allowInactiveMembership:true});const raw=new URL(req.url).searchParams.get('threadId');const threadId=raw?supportId.parse(raw):null;
  const threads=await db<{id:string;subject:string;status:string;updated_at:string}[]>(`icash_support_threads?account_id=eq.${accountId}&select=id,subject,status,updated_at&order=updated_at.desc&limit=30`);
  const chosen=threadId??threads[0]?.id;
  if(threadId&&!threads.some(t=>t.id===threadId))return NextResponse.json({error:'Conversation not found.'},{status:404,headers});
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
  const {accountId,userId}=await workAccount({allowInactiveMembership:true});const raw=await req.text();if(raw.length>5000)return NextResponse.json({error:'Message too long.'},{status:413,headers});
  const value=JSON.parse(raw);
  if(value.action==='escalate'){
   const i=z.object({action:z.literal('escalate'),threadId:supportId}).strict().parse(value);
   const escalated=await db<boolean>('rpc/icash_support_escalate','POST',{p_account:accountId,p_user:userId,p_thread:i.threadId});
   if(!escalated)return NextResponse.json({error:'Conversation not found.'},{status:404,headers});
   return NextResponse.json({escalated:true},{headers});
  }
  const i=supportMessageInput.parse(value);
  // Redact common credentials/contact details before durable storage and model use.
  const question=redactSupportQuestion(i.message);
  const started=await db<{threadId:string;replay?:boolean;response?:unknown;rateLimited?:boolean}>('rpc/icash_support_begin_message','POST',{p_account:accountId,p_user:userId,p_thread:i.threadId??null,p_request:i.requestId,p_message:question});
  if(started.rateLimited)return NextResponse.json({error:'Please wait a minute before sending more messages. The daily limit is 60 messages.'},{status:429,headers});
  if(started.replay)return NextResponse.json({threadId:started.threadId,replay:true,pending:!started.response},{status:started.response?200:202,headers});
  const evidence=await collectSupportDiagnostics(accountId);const selected=await classifySupportQuestion(question,evidence);
  const answer=supportAnswer(selected.topic,evidence,selected.ai);
  await db('rpc/icash_support_finish_message','POST',{p_account:accountId,p_user:userId,p_thread:started.threadId,p_request:i.requestId,p_message:answer,p_evidence:evidence});
  return NextResponse.json({threadId:started.threadId,ai:selected.ai},{headers});
 }catch(e){const auth=e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message);return NextResponse.json({error:auth?'Sign in to get help.':e instanceof z.ZodError||e instanceof SyntaxError?'Please check your message and try again.':'Could not confirm that the reply was saved. Refresh the conversation before retrying.'},{status:auth?401:e instanceof z.ZodError||e instanceof SyntaxError?400:503,headers});}
}
