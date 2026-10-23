import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {workspaceEventStream} from '@/lib/workspace-event-stream';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:Request){
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(55000)]);
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 try{
  const {accountId}=await workAccount({allowInactiveMembership:true,signal});
  const stream=workspaceEventStream({accountId,signal,read:(readSignal)=>db('rpc/icash_workspace_revision_batch','POST',{p_accounts:[accountId]},AbortSignal.any([readSignal,AbortSignal.timeout(8000)]))});
  return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});
 }catch(error){
  const reason=error instanceof Error?error.message:'';
  if(reason==='SIGN_IN_REQUIRED')return Response.json({error:'Sign in to receive live updates.'},{status:401,headers});
  if(['ACCOUNT_REQUIRED','WORKSPACE_ACKNOWLEDGMENT_REQUIRED','SUBSCRIPTION_REQUIRED','VIP_REQUIRED'].includes(reason))return Response.json({error:'Workspace access is required for live updates.'},{status:403,headers});
  return Response.json({error:'Live updates are temporarily unavailable.'},{status:503,headers});
 }
}
