import {dashboardWorkAccount} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {privateHeaders} from '@/lib/required-call-recording';
import {readDemoReadiness} from '@/lib/demo-readiness';
import {db} from '@/lib/stripe-test';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=40;
const unavailable=(status:number)=>Response.json({error:'Could not check the owner demo setup.'},{status,headers:privateHeaders});
export async function GET(request:Request){
 try{
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/api/demo/readiness'||url.search||request.body!==null||request.headers.get('host')!==url.host)return unavailable(400);
  if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||request.headers.has('origin')&&request.headers.get('origin')!==url.origin)return unavailable(403);
  const owner=await dashboardWorkAccount();
  if(owner.accountId!==ownerInboundTarget.accountId||owner.userId!==ownerInboundTarget.ownerUserId)return unavailable(403);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(14000)]);
  const result=await readDemoReadiness(process.env,{db:(path,method,body)=>db(path,method,body,signal),signal});
  return Response.json(result,{headers:privateHeaders});
 }catch(e){return unavailable(e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message)?401:503);}
}
