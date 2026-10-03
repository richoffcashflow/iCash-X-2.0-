import {ownerRecordingServer} from '@/lib/owner-recording-test-server';
import {recordingServer} from '@/lib/required-call-recording-server';
import {boundedBytes} from '@/lib/required-call-recording-provider';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:Request){
 let production=request;
 if(process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY==='true'){
  try{
   // Read one bounded body, then use finite copies. A cancelled tee must not stall fallback.
   const body=await boundedBytes(request,2048);
   const copy=()=>new Request(request.url,{method:'POST',headers:request.headers,body,signal:request.signal});
   production=copy();
   try{const owner=await ownerRecordingServer().stop(copy());if(owner)return owner;}catch{/* Owner lookup faults must not disable production withdrawal authentication. */}
  }catch{return new Response(null,{status:400,headers:{'Cache-Control':'no-store'}});}
 }
 try{return await recordingServer(request.signal).stop(production);}catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}
}
