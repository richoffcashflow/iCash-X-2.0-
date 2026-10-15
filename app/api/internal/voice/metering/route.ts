import {db} from '@/lib/stripe-test';
import {createRecordingProviders} from '@/lib/required-call-recording-provider';
import {processVoiceMeterTicket,validVoiceMeterToken} from '@/lib/voice-live-metering';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=15;
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=request.headers.get('authorization')?.match(/^Bearer (.*)$/)?.[1]??'';
 if(request.body!==null||new URL(request.url).search||!validVoiceMeterToken(token))return Response.json({status:'unauthorized'},{status:401,headers});
 const deadline=AbortSignal.timeout(6500);
 try{
  const result=await processVoiceMeterTicket(token,(name,body)=>db('rpc/'+name,'POST',body,deadline),createRecordingProviders({...process.env},fetch,deadline));
  return Response.json({status:result.status},{status:result.httpStatus,headers});
 }catch{
  // A lost command never restores funding or repeats a dial. The hard carrier
  // ceiling and retained DB commitment remain the failure backstop.
  return Response.json({status:'metering_review_required'},{status:503,headers});
 }
}
