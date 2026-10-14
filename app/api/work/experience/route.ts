import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {workspaceExperienceSchema} from '@/lib/workspace-experience';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function boundedBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256){await reader.cancel();return null;}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function POST(request:Request){
 if(!allowedOrigin(request))return new Response(null,{status:403,headers});
 if(process.env.VERCEL_ENV==='preview')return new Response(null,{status:204,headers});
 if(Number(request.headers.get('content-length'))>256)return new Response(null,{status:413,headers});
 try{
  const raw=await boundedBody(request);if(raw===null)return new Response(null,{status:413,headers});
  let input;try{input=workspaceExperienceSchema.parse(JSON.parse(raw));}catch{return new Response(null,{status:400,headers});}
  const {accountId,userId}=await workAccount({allowInactiveMembership:true});
  await db('rpc/icash_record_workspace_experience','POST',{p_account:accountId,p_user:userId,p_event:input.event,p_stage:input.stage},request.signal);
  return new Response(null,{status:204,headers});
 }catch(error){return new Response(null,{status:error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message)?401:503,headers});}
}
