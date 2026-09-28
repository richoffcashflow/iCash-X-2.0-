import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {voiceTestAccess,voiceHeaders,type VoiceTestSession} from '@/lib/voice-test-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 let hash:string;
 try{hash=await voiceTestAccess(req);}catch{return NextResponse.json({error:'This private test link is unavailable or expired.'},{status:403,headers:voiceHeaders});}
 try{
  const id=await db<string>('rpc/icash_reserve_voice_test','POST',{p_hash:hash});
  const [s]=await db<VoiceTestSession[]>(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&select=*`);
  // No automatic retry: unknown provider outcomes retain the reservation and cannot create duplicate sessions.
  const token=await elevenRequest<{token:string;conversation_id:string}>(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(s.agent_id)}`);
  if(!token.token||!/^conv_[a-zA-Z0-9]+$/.test(token.conversation_id))throw new Error('VOICE_TOKEN_RESPONSE_INVALID');
  await db(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&state=eq.reserved`,'PATCH',{conversation_id:token.conversation_id,state:'issued'});
  return NextResponse.json({sessionId:id,conversationToken:token.token,maxDurationSeconds:180},{headers:voiceHeaders});
 }catch{return NextResponse.json({error:'Voice test unavailable. Another test may be active, the allowance may be used, or the provider needs attention. No seller was called.'},{status:503,headers:voiceHeaders});}
}
