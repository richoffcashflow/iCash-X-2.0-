import {workAccount} from '@/lib/work-account';
import {recordedReceptionServer} from '@/lib/recorded-reception-server';
import {uuid,privateHeaders} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function GET(request:Request){try{const {accountId}=await workAccount(),u=new URL(request.url),id=u.searchParams.get('id');if(!uuid(id)||u.searchParams.size!==1)return new Response(null,{status:404,headers:privateHeaders});return await recordedReceptionServer(request.signal).audio(accountId,id,request.headers.get('range'));}catch{return new Response(null,{status:404,headers:privateHeaders});}}
