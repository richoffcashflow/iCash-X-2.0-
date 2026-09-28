import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {voiceTestAccess,voiceHeaders} from '@/lib/voice-test-server';
export const runtime='nodejs';
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Open the private test page to import a call.'},{status:403,headers:voiceHeaders});
 let hash:string;
 try{hash=await voiceTestAccess(req);}catch{return NextResponse.json({error:'Private test access required.'},{status:403,headers:voiceHeaders});}
 let conversationId:unknown;
 try{const body=await req.text();if(body.length>512)throw Error();conversationId=JSON.parse(body).conversationId;}catch{return NextResponse.json({error:'Enter the ElevenLabs conversation ID.'},{status:400,headers:voiceHeaders});}
 if(typeof conversationId!=='string'||!/^conv_[a-zA-Z0-9_-]{1,120}$/.test(conversationId))return NextResponse.json({error:'Enter a conversation ID beginning with conv_.'},{status:400,headers:voiceHeaders});
 try{
  // Reserve an ID only. The result route must independently verify the provider's
  // conversation and agent IDs before any notes or callback record can be saved.
  const sessionId=await db<string>('rpc/icash_import_voice_test','POST',{p_hash:hash,p_conversation:conversationId});
  return NextResponse.json({sessionId},{headers:voiceHeaders});
 }catch{return NextResponse.json({error:'Unable to import. Wait a few seconds and retry. Each private link allows up to 10 imported calls.'},{status:409,headers:voiceHeaders});}
}
