import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {redactSupportQuestion} from '@/lib/support-policy';
import {workspaceAssistantContext} from '@/lib/workspace-assistant-context';
import {routeWorkspaceQuestion} from '@/lib/workspace-assistant-ai';
import {answerWorkspaceQuestion,type AssistantAnswer} from '@/lib/workspace-assistant-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
const input=z.object({requestId:z.string().uuid(),question:z.string().trim().min(1).max(1500),timezone:z.string().max(100),screeningId:z.string().uuid().optional()}).strict();
type Row={id:string;question:string;answer:AssistantAnswer|null;state:string;created_at:string};
function error(e:unknown){const message=e instanceof Error?e.message:'';const status=['SUBSCRIPTION_REQUIRED','QUESTION_CREDITS_REQUIRED'].includes(message)?402:['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(message)?401:message==='PROPERTY_NOT_FOUND'?404:e instanceof z.ZodError||e instanceof SyntaxError?400:503;return NextResponse.json({error:message==='QUESTION_CREDITS_REQUIRED'?'Add credits or allow more spending today to ask your bot.':status===402?'Restore your subscription to ask your bot.':status===401?'Sign in to ask your bot.':status===404?'This property is not available in your workspace.':status===400?'Check your question and try again.':'Could not finish your reply. Your work is unchanged. Try again.'},{status,headers});}
export async function GET(req:Request){try{
 const {accountId}=await workAccount(),id=new URL(req.url).searchParams.get('id');if(id)z.string().uuid().parse(id);
 const items=await db<Row[]>(`icash_workspace_questions?account_id=eq.${accountId}${id?'&id=eq.'+id:''}&select=id,question,answer,state,created_at&order=created_at.desc&limit=${id?1:20}`);
 if(id&&!items.length)return NextResponse.json({error:'Reply not found.'},{status:404,headers});
 return NextResponse.json({items:items.reverse()},{headers});
 }catch(e){return error(e);}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 let accountId='',savedId='';
 try{
  const owner=await workAccount();accountId=owner.accountId;
  const raw=await req.text();if(raw.length>6000)return NextResponse.json({error:'Please shorten your question.'},{status:413,headers});
  const i=input.parse(JSON.parse(raw));try{new Intl.DateTimeFormat('en-US',{timeZone:i.timezone});}catch{return NextResponse.json({error:'Invalid timezone.'},{status:400,headers});}
  try{await limitRequest(req,'workspace-assistant',accountId,15,600);}catch{return NextResponse.json({error:'Please wait a few minutes before asking more questions.'},{status:429,headers});}
  const question=redactSupportQuestion(i.question);
  const started=await db<{id:string;fresh:boolean;state:string;answer:AssistantAnswer|null;createdAt:string}>('rpc/icash_begin_workspace_question','POST',{p_account:accountId,p_user:owner.userId,p_request:i.requestId,p_question:question});
  savedId=started.id;
  if(!started.fresh){if(started.state==='error')return NextResponse.json({error:'This reply could not finish. Please send the question again.'},{status:409,headers});return NextResponse.json({id:started.id,question,answer:started.answer,state:started.state,created_at:started.createdAt},{status:started.answer?200:202,headers});}
  const [context,history]=await Promise.all([workspaceAssistantContext(accountId,i.timezone,question,i.screeningId),db<Row[]>(`icash_workspace_questions?account_id=eq.${accountId}&state=eq.complete&select=id,question,answer,state,created_at&order=created_at.desc&limit=4`)]);
  await db(`icash_workspace_questions?account_id=eq.${accountId}&id=eq.${savedId}&state=eq.pending`,'PATCH',{context_snapshot:context});
  const routed=await routeWorkspaceQuestion(question,context,history.reverse().map(h=>({question:h.question,propertyId:h.answer?.propertyId??null})),fetch,{
   before:async()=>{try{return await db<boolean>('rpc/icash_reserve_question','POST',{p_account:accountId,p_question:savedId,p_model:process.env.ICASH_SUPPORT_AI_MODEL});}catch{throw Error('QUESTION_CREDITS_REQUIRED');}},
   after:async receipt=>{const u=receipt.usage as {prompt_tokens?:number;completion_tokens?:number;prompt_tokens_details?:{cached_tokens?:number}}|null;await db('rpc/icash_settle_question','POST',{p_account:accountId,p_question:savedId,p_provider:receipt.providerId,p_input:u?.prompt_tokens??null,p_cached:u?.prompt_tokens_details?.cached_tokens??0,p_output:u?.completion_tokens??null});}
  });
  const answer=answerWorkspaceQuestion(routed.intent,context,routed.propertyId);
  const [saved]=await db<Row[]>(`icash_workspace_questions?account_id=eq.${accountId}&id=eq.${savedId}&state=eq.pending`,'PATCH',{answer,state:'complete',model:routed.model,provider_id:routed.providerId,token_usage:{usage:routed.usage,classification:routed.raw},completed_at:new Date().toISOString()});
  if(!saved)throw Error('SAVE_FAILED');
  return NextResponse.json({id:savedId,question,answer,state:'complete',created_at:started.createdAt},{headers});
 }catch(e){if(savedId&&accountId)try{await db(`icash_workspace_questions?account_id=eq.${accountId}&id=eq.${savedId}&state=eq.pending`,'PATCH',{state:'error'});}catch{}return error(e);}
}
