import {workAccount} from '@/lib/work-account';
import {recordingServer} from '@/lib/required-call-recording-server';
import {uuid,privateHeaders} from '@/lib/required-call-recording';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=30;
export async function GET(request:Request){try{
 const {accountId}=await workAccount();const id=new URL(request.url).searchParams.get('id');if(!uuid(id))return new Response(null,{status:404,headers:privateHeaders});
 return await recordingServer().audio(accountId,id,request.headers.get('range'));
 }catch{return new Response(null,{status:404,headers:privateHeaders});}}
