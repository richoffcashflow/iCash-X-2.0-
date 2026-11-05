import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {readCustomVoicePreview,prepareCustomVoicePreview,type VoicePreviewResult} from '@/lib/custom-voice-preview';
export const runtime='nodejs';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
function reply(result:VoicePreviewResult){
 if(result.state==='ready')return new Response(new Uint8Array(result.audio),{headers:{...headers,'Content-Type':'audio/mpeg','Content-Length':String(result.audio.length)}});
 return NextResponse.json({state:result.state},{status:result.state==='empty'?404:result.state==='pending'?202:409,headers});
}
const failed=()=>NextResponse.json({error:'Could not load your voice preview. Please try again.'},{status:409,headers});
export async function GET(){
 try{const {accountId}=await workAccount({requireVip:true});return reply(await readCustomVoicePreview(accountId));}catch{return failed();}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount({requireVip:true});
  await limitRequest(req,'custom-voice-preview',accountId,10,60);
  // Next wraps even a bodyless HTTP POST in a stream. Accept its empty EOF;
  // reject and cancel any content without buffering arbitrary user input.
  if(req.body){const reader=req.body.getReader();const {done}=await reader.read();await reader.cancel();if(!done)return NextResponse.json({error:'Invalid preview request'},{status:400,headers});}
  return reply(await prepareCustomVoicePreview(accountId,userId));
 }catch{return failed();}
}
