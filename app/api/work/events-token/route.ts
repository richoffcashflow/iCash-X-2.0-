import {workAccount} from '@/lib/work-account';
import {mintWorkspaceEventToken} from '@/lib/workspace-event-token';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 try{
  const {accountId}=await workAccount({allowInactiveMembership:true});
  const configured=process.env.ICASH_WORKSPACE_EVENTS_URL;
  if(!configured||!process.env.SUPABASE_SECRET_KEY)return Response.json({available:false},{headers});
  const url=new URL(configured);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/workspace/events')throw Error('Invalid event endpoint');
  return Response.json({available:true,url:url.href,accountId,...mintWorkspaceEventToken(accountId,process.env.SUPABASE_SECRET_KEY)},{headers});
 }catch{return Response.json({error:'Live updates are temporarily unavailable.'},{status:503,headers});}
}
