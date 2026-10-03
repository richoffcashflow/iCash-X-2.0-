import {workAccount} from '@/lib/work-account';
import {receptionTarget} from '@/lib/general-reception';
import {privateHeaders} from '@/lib/required-call-recording';
import {readRecordedReceptionReadiness} from '@/lib/recorded-reception-readiness';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
const unavailable=(status:number)=>Response.json({status:'unavailable'},{status,headers:privateHeaders});
export async function GET(request:Request){try{
 const account=await workAccount();
 if(account.accountId!==receptionTarget.accountId||account.userId!==receptionTarget.ownerUserId)return unavailable(403);
 const url=new URL(request.url);
 if(request.method!=='GET'||url.pathname!=='/api/owner-reception/recorded-readiness'||url.search||url.username||url.password||request.headers.get('host')!==url.host)return unavailable(400);
 if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||request.headers.has('origin')&&request.headers.get('origin')!==url.origin)return unavailable(403);
 const result=await readRecordedReceptionReadiness({ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY},{signal:request.signal});
 return Response.json(result,{status:result.status==='unavailable'?503:200,headers:privateHeaders});
}catch(e){return unavailable(e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message)?401:503);}}
