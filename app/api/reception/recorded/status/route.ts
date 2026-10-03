import {recordedReceptionServer} from '@/lib/recorded-reception-server';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(request:Request){try{return await recordedReceptionServer(request.signal).status(request);}catch{return new Response(null,{status:503,headers:privateHeaders});}}
