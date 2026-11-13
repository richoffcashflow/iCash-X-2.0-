import {dashboardWorkAccount} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {privateHeaders,uuid,object} from '@/lib/required-call-recording';
import {db} from '@/lib/stripe-test';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=25;
const fail=(status:number,error:string)=>Response.json({error},{status,headers:privateHeaders});
export async function POST(request:Request){
 try{
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/api/demo/reset'||url.search||request.headers.get('host')!==url.host)return fail(400,'Open the owner workspace to reset.');
  if(request.headers.get('origin')!==url.origin||!['same-origin',null].includes(request.headers.get('sec-fetch-site')))return fail(403,'Open the owner workspace to reset.');
  if(request.headers.get('content-type')!=='application/json'||Number(request.headers.get('content-length')??0)>200)return fail(400,'Invalid reset request.');
  const owner=await dashboardWorkAccount();
  if(owner.accountId!==ownerInboundTarget.accountId||owner.userId!==ownerInboundTarget.ownerUserId)return fail(403,'Only the owner can reset this account.');
  const reader=request.body?.getReader();if(!reader)return fail(400,'Invalid reset request.');
  let raw='',size=0;const decoder=new TextDecoder();
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>200){await reader.cancel();return fail(400,'Invalid reset request.');}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  let input:Record<string,unknown>;try{input=object(JSON.parse(raw));}catch{return fail(400,'Invalid reset request.');}
  if(Object.keys(input).length!==1||!uuid(input.requestId))return fail(400,'Invalid reset request.');
  const result=object(await db('rpc/icash_reset_owner_account','POST',{p_actor:owner.userId,p_account:owner.accountId,p_request:input.requestId},AbortSignal.timeout(18000)));
  if(result.status==='waiting'&&['active_call','active_work'].includes(String(result.reason)))return Response.json({status:'waiting',reason:result.reason},{status:202,headers:privateHeaders});
  if(result.status!=='reset'||result.requestId!==input.requestId||result.historyPreserved!==true||result.providerWrites!==false)throw Error('RESET_NOT_VERIFIED');
  return Response.json(result,{headers:privateHeaders});
 }catch(e){return fail(e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED','DASHBOARD_PASSWORD_REQUIRED'].includes(e.message)?401:503,'Could not confirm the reset. Try again to check the same request.');}
}
