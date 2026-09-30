import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireTrustedOperator} from '@/lib/trusted-operator';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {supportId,supportStatusInput,redactSupportQuestion} from '@/lib/support-policy';
import {collectSupportDiagnostics,supportDeploymentHealth} from '@/lib/support-diagnostics';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(e:unknown){const denied=e instanceof Error&&['SIGN_IN_REQUIRED','OPERATOR_REQUIRED'].includes(e.message);return NextResponse.json({error:denied?'A provisioned support operator account is required.':'Support queue is temporarily unavailable.'},{status:denied?403:e instanceof z.ZodError?400:503,headers});}
export async function GET(req:Request){
 try{
  await requireTrustedOperator();const raw=new URL(req.url).searchParams.get('threadId');
  if(raw){const id=supportId.parse(raw);const [thread]=await db<{id:string;account_id:string;status:string;subject:string}[]>(`icash_support_threads?id=eq.${id}&select=id,account_id,status,subject`);if(!thread)return NextResponse.json({error:'Conversation not found.'},{status:404,headers});
   const [messages,evidence]=await Promise.all([db(`icash_support_messages?thread_id=eq.${id}&account_id=eq.${thread.account_id}&select=id,role,content,evidence,created_at&order=created_at.desc&limit=100`),collectSupportDiagnostics(thread.account_id)]);
   return NextResponse.json({thread,messages:Array.isArray(messages)?messages.reverse():[],evidence},{headers});
  }
  const [threads,cancellations,deployment]=await Promise.all([
   db('icash_support_threads?select=id,account_id,subject,status,updated_at&order=updated_at.desc&limit=100'),
   db('icash_support_cancel_requests?or=(state.in.(processing,needs_review),and(state.neq.cancelled,receipt_state.in.(claimed,needs_review,suppressed,rate_limited)))&select=id,account_id,mode,state,result,receipt_state,updated_at&order=updated_at.desc&limit=30'),supportDeploymentHealth()
  ]);
  return NextResponse.json({threads,cancellations,deployment},{headers});
 }catch(e){return failure(e);}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const {userId}=await requireTrustedOperator();const raw=await req.text();if(raw.length>6000)return NextResponse.json({error:'Reply too long.'},{status:413,headers});const i=supportStatusInput.parse(JSON.parse(raw));
  await db('rpc/icash_support_operator_update','POST',{p_operator:userId,p_thread:i.threadId,p_request:i.requestId,p_status:i.status,p_reply:i.reply?redactSupportQuestion(i.reply):null});
  return NextResponse.json({saved:true},{headers});
 }catch(e){return failure(e);}
}
