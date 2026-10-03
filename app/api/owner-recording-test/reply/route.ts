import {workAccount} from '@/lib/work-account';
import {ownerCallReplyInspectorServer} from '@/lib/owner-call-reply-inspector-server';
import {privateHeaders,uuid} from '@/lib/required-call-recording';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
export async function GET(request:Request){
 const headers={...privateHeaders,'X-Content-Type-Options':'nosniff'};
 if(process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY!=='true')return Response.json({status:'unavailable',reason:'not_released'},{status:404,headers});
 const query=new URL(request.url).searchParams,id=query.get('id');
 if(query.size!==1||query.getAll('id').length!==1||!uuid(id))return Response.json({status:'unavailable',reason:'owner_run_unavailable'},{status:400,headers});
 let owner;try{owner=await workAccount();}catch{return Response.json({status:'unavailable',reason:'owner_sign_in_required'},{status:403,headers});}
 try{
  const result=await ownerCallReplyInspectorServer(request.signal)(owner,id!);
  return Response.json(result,{status:result.status==='unavailable'?404:result.status==='provider_access_denied'?502:200,headers});
 }catch{return Response.json({status:'unavailable',reason:'owner_reply_unavailable'},{status:503,headers});}
}
