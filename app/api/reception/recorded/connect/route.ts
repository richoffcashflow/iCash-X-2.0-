import {recordedReceptionServer} from '@/lib/recorded-reception-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(request:Request){try{return await recordedReceptionServer(request.signal).connect(request);}catch{return new Response('<Response><Hangup/></Response>',{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});}}
