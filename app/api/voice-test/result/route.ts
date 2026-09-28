import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {voiceResult,type VoiceConversation} from '@/lib/voice-result';
import {voiceTestAccess,voiceHeaders,type VoiceTestSession} from '@/lib/voice-test-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 let hash:string;
 try{hash=await voiceTestAccess(req);}catch{return NextResponse.json({error:'Private test access required.'},{status:403,headers:voiceHeaders});}
 const id=new URL(req.url).searchParams.get('session');
 if(!id||!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Invalid test.'},{status:400,headers:voiceHeaders});
 try{
  const [s]=await db<VoiceTestSession[]>(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&select=*`);
  if(!s)return NextResponse.json({error:'Test not found.'},{status:404,headers:voiceHeaders});
  if(s.state==='complete'&&(s.result as {resultVersion?:number})?.resultVersion===2)return NextResponse.json({status:'complete',result:s.result},{headers:voiceHeaders});
  if(!s.conversation_id)return NextResponse.json({status:'unavailable'},{headers:voiceHeaders});
  if(Date.now()-Date.parse(s.created_at)>24*3600000)return NextResponse.json({status:'needs_review'},{headers:voiceHeaders});
  if(s.state!=='complete'&&!await db<boolean>('rpc/icash_voice_test_poll','POST',{p_id:id,p_hash:hash}))return NextResponse.json({status:'processing'},{headers:voiceHeaders});
  const conversation=await elevenRequest<VoiceConversation>(`/v1/convai/conversations/${encodeURIComponent(s.conversation_id)}`);
  const result=voiceResult(conversation,{conversationId:s.conversation_id,agentId:s.agent_id});
  if(!result)return NextResponse.json({status:conversation.status==='failed'?'failed':'processing'},{headers:voiceHeaders});
  const rows=await db<VoiceTestSession[]>(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&state=in.(issued,complete)`,'PATCH',{state:'complete',completed_at:new Date().toISOString(),result,callback_status:result.callbackStatus,callback_due_at:result.dueAt});
  if(!rows.length)return NextResponse.json({status:'processing'},{headers:voiceHeaders});
  return NextResponse.json({status:'complete',result},{headers:voiceHeaders});
 }catch{return NextResponse.json({error:'The provider result is not ready. You can check again without starting another call.'},{status:503,headers:voiceHeaders});}
}
