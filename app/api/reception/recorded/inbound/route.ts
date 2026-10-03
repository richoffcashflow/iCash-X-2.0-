import {recordedReceptionServer} from '@/lib/recorded-reception-server';
import {privateHeaders} from '@/lib/required-call-recording';
import {rejectTwiml} from '@/lib/general-reception';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(request:Request){
 if(process.env.ICASH_RECORDED_RECEPTION_READY!=='true')return new Response(rejectTwiml,{headers:{...privateHeaders,'Content-Type':'application/xml'}});
 try{return await recordedReceptionServer(request.signal).inbound(request);}catch{return new Response('<Response><Hangup/></Response>',{headers:{...privateHeaders,'Content-Type':'application/xml'}});}}
