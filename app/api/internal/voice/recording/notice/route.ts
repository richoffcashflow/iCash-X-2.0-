import {recordingServer} from '@/lib/required-call-recording-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(request:Request){try{return await recordingServer(request.signal).consent(request,true);}catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}}
