import {recordedReceptionServer} from '@/lib/recorded-reception-server';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(request:Request){try{return await recordedReceptionServer(request.signal).consent(request);}catch{return new Response('<Response><Hangup/></Response>',{headers:{...privateHeaders,'Content-Type':'application/xml'}});}}
