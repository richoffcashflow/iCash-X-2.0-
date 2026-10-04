import {receptionHandlers} from '@/lib/general-reception-server';
import {recordedReceptionServer} from '@/lib/recorded-reception-server';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(request:Request){
 if(process.env.ICASH_RECORDED_RECEPTION_READY!=='true')return receptionHandlers().inbound(request);
 try{return await recordedReceptionServer(request.signal).inbound(request);}
 catch{return new Response('<Response><Hangup/></Response>',{headers:{...privateHeaders,'Content-Type':'application/xml'}});}
}
