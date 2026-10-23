import {workAccount} from '@/lib/work-account';
import {recordingServer} from '@/lib/required-call-recording-server';
import {uuid,privateHeaders} from '@/lib/required-call-recording';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=30;
export async function GET(request:Request){
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(25000)]);
 try{
 const {accountId}=await workAccount({signal}),params=new URL(request.url).searchParams,id=params.get('id');if(params.size!==1||!uuid(id))return new Response(null,{status:404,headers:privateHeaders});
 return await recordingServer(signal).audio(accountId,id,request.headers.get('range'));
 }catch(error){
 const denied=error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED','WORKSPACE_ACKNOWLEDGMENT_REQUIRED','SUBSCRIPTION_REQUIRED','VIP_REQUIRED'].includes(error.message);
 return new Response(null,{status:denied?404:503,headers:privateHeaders});
 }}
