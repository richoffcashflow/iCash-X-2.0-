import {recordPropertyCost} from '@/lib/operating-costs';
import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {voiceTestAccess,voiceHeaders,type VoiceTestSession} from '@/lib/voice-test-server';
import {loadTestProperty} from '@/lib/dealmachine-property';
import {propertyIdPattern,propertyVoiceContext,type PropertyContext} from '@/lib/property-context';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Open the private test page to start.'},{status:403,headers:voiceHeaders});
 let hash:string;
 try{hash=await voiceTestAccess(req);}catch{return NextResponse.json({error:'This private test link is unavailable or expired.'},{status:403,headers:voiceHeaders});}
 let propertyId='';
 try{const body=await req.text();if(body.length>256)throw new Error();const data=body?JSON.parse(body):{};propertyId=data.propertyId??'';if(typeof propertyId!=='string'||(propertyId&&!propertyIdPattern.test(propertyId)))throw new Error();}
 catch{return NextResponse.json({error:'Enter a valid DealMachine property ID.'},{status:400,headers:voiceHeaders});}
 if(propertyId&&!process.env.DEALMACHINE_API_KEY)return NextResponse.json({error:'Property data is not configured.'},{status:503,headers:voiceHeaders});
 let reservedId:string|null=null;
 try{
  const id=await db<string>('rpc/icash_reserve_voice_test','POST',{p_hash:hash});
  reservedId=id;
  const [s]=await db<VoiceTestSession[]>(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&select=*`);
  let property:PropertyContext|null=null;
  if(propertyId){
   await db(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&state=eq.reserved`,'PATCH',{property_lookup_status:'reserved'});
   property=await loadTestProperty(propertyId,process.env.DEALMACHINE_API_KEY!);
   await db(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&state=eq.reserved`,'PATCH',{property_context:property,property_lookup_status:'complete'});
   await recordPropertyCost(id,property.vendorCreditsUsed);
  }
  // No automatic retry: unknown provider outcomes retain the reservation and cannot create duplicate sessions.
  const token=await elevenRequest<{token:string;conversation_id:string}>(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(s.agent_id)}`);
  if(!token.token||!/^conv_[a-zA-Z0-9]+$/.test(token.conversation_id))throw new Error('VOICE_TOKEN_RESPONSE_INVALID');
  await db(`icash_voice_test_sessions?id=eq.${id}&token_hash=eq.${hash}&state=eq.reserved`,'PATCH',{conversation_id:token.conversation_id,state:'issued'});
  return NextResponse.json({sessionId:id,conversationToken:token.token,maxDurationSeconds:180,propertyContext:property,contextualUpdate:property?propertyVoiceContext(property):null},{headers:voiceHeaders});
 }catch{
  if(reservedId&&propertyId)try{await db(`icash_voice_test_sessions?id=eq.${reservedId}&token_hash=eq.${hash}&property_lookup_status=eq.reserved`,'PATCH',{property_lookup_status:'unknown'});}catch{}
  return NextResponse.json({error:'Test could not start. It may be active, out of allowance, or waiting on a provider. Any attempted property lookup is not retried automatically. No seller was called.'},{status:503,headers:voiceHeaders});}
}
