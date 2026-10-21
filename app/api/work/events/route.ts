import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {workspaceEventStream} from '@/lib/workspace-event-stream';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 try{
  const {accountId}=await workAccount({allowInactiveMembership:true});
  const stream=workspaceEventStream({accountId,signal:request.signal,read:()=>db('rpc/icash_workspace_revision_batch','POST',{p_accounts:[accountId]},AbortSignal.any([request.signal,AbortSignal.timeout(8000)]))});
  return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});
 }catch{return Response.json({error:'Live updates are temporarily unavailable.'},{status:503,headers});}
}
