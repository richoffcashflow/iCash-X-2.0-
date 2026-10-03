import {workAccount} from '@/lib/work-account';
import {ownerRecordingServer} from '@/lib/owner-recording-test-server';
import {privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY!=='true')return new Response(null,{status:404});return ownerRecordingServer().audio(await workAccount(),new URL(request.url).searchParams.get('id')??'');}catch{return new Response(null,{status:404,headers:privateHeaders});}}
