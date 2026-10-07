import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {receptionTarget} from '@/lib/general-reception';
import {reconcileReception} from '@/lib/general-reception-reconcile';
import {reconcileReceptionTerminals} from '@/lib/reception-terminal-reconciliation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){
 try{
  const owner=await workAccount();
  if(owner.accountId!==receptionTarget.accountId||owner.userId!==receptionTarget.ownerUserId)return Response.json({status:'owner_required'},{status:403,headers});
  const url=new URL(request.url);
  if(url.search||request.headers.get('origin')!==url.origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||Number(request.headers.get('content-length')??0)>0||await request.text()!=='')return Response.json({status:'fixed_request_required'},{status:400,headers});
  const env={TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN,ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY};
  const [result,terminals]=await Promise.all([
   reconcileReception(env,{rpc:(name,body,signal)=>db(`rpc/${name}`,'POST',body??{},signal)}),
   reconcileReceptionTerminals(env,(name,body)=>db(`rpc/${name}`,'POST',body)).catch(()=>({verified:0,total:2,billingUnchanged:true})),
  ]);
  return Response.json({...result,terminals,message:result.message+(terminals.verified===terminals.total?' Both historical calls are confirmed ended. Pending billing reservations remain intact.':'')},{headers});
 }catch{return Response.json({status:'reconciliation_unavailable'},{status:503,headers});}
}
