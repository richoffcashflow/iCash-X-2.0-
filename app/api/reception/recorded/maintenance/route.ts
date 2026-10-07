import {maintainCustomerPhoneCalls} from '@/lib/customer-phone';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {createRecordedReceptionProviders} from '@/lib/recorded-reception-provider';
import {maintainRecordedReception} from '@/lib/recorded-reception-maintenance';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){
 const secret=process.env.CRON_SECRET,header=request.headers.get('authorization');
 if(!secret||secret.length<32||!header)return new Response(null,{status:401,headers:privateHeaders});
 const a=Buffer.from(header),b=Buffer.from('Bearer '+secret);if(a.length!==b.length||!timingSafeEqual(a,b))return new Response(null,{status:401,headers:privateHeaders});
 // Schema readiness only. Keep true once installed; never couple to capture or pauses.
 if(process.env.ICASH_RECORDED_RECEPTION_SCHEMA_READY!=='true')return Response.json({status:'schema_not_released'},{headers:privateHeaders});
 const deadline=AbortSignal.any([request.signal,AbortSignal.timeout(50000)]);
 try{const [result]=await Promise.all([maintainRecordedReception((name,body)=>db('rpc/'+name,'POST',body??{},deadline),createRecordedReceptionProviders(process.env,fetch,deadline),process.env),maintainCustomerPhoneCalls().catch(()=>undefined)]);return Response.json(result,{headers:privateHeaders});}
 catch{return Response.json({status:'recorded_reception_maintenance_needs_review'},{status:503,headers:privateHeaders});}
}
export const GET=POST;
