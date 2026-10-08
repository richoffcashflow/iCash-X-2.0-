import {recordingServer} from '@/lib/required-call-recording-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){try{return await recordingServer(request.signal).consent(request,false,true);}catch{return new Response('<Response><Hangup/></Response>',{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});}}
