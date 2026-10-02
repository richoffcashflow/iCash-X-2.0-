import {beginOwnerInbound} from '@/lib/owner-inbound-acceptance-service';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {createHash} from 'node:crypto';
import {elevenRequest} from '@/lib/elevenlabs';
import {inboundAuthorized,inboundCallSchema,inboundCapability,inboundInitiation} from '@/lib/inbound-voice';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 const secret=process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET;
 if(!inboundAuthorized(req.headers.get('authorization'),secret))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 if(process.env.ICASH_LIVE_WORK_READY!=='true'&&process.env.ICASH_OWNER_INBOUND_TEST_ENABLED!=='true')return NextResponse.json({error:'Call routing unavailable'},{status:503,headers});
 try{
  if(Number(req.headers.get('content-length')??0)>4096)throw new Error('Invalid request');
  const raw=await req.text();if(Buffer.byteLength(raw)>4096)throw new Error('Invalid request');
  const call=inboundCallSchema.parse(JSON.parse(raw));
  // This exact owner/ingress pair never falls through to business routing.
  // Its separate release flag does not enable global work or seller permissions.
  if(call.caller_id===ownerInboundTarget.ownerPhone&&call.called_number===ownerInboundTarget.ingressNumber&&call.agent_id===ownerInboundTarget.agentId){
   const result=await beginOwnerInbound(call);
   return NextResponse.json(result??{error:'Call routing unavailable'},{status:result?200:409,headers});
  }
  if(process.env.ICASH_LIVE_WORK_READY!=='true')return NextResponse.json({error:'Call routing unavailable'},{status:503,headers});
  const cap=inboundCapability(call,secret!);
  // Fetch no customer data until the called number and agent are explicitly registered.
  const routes=await db<{agent_id:string}[]>(`icash_inbound_voice_routes?called_number=eq.${encodeURIComponent(call.called_number)}&agent_id=eq.${call.agent_id}&enabled=eq.true&select=agent_id&limit=1`);
  if(routes.length!==1)throw new Error('Unregistered route');
  const agent=await elevenRequest<{conversation_config:unknown}>(`/v1/convai/agents/${call.agent_id}`);
  const agentHash=createHash('sha256').update(JSON.stringify(agent.conversation_config)).digest('hex');
  const result=await db<{maxSeconds:number}|null>('rpc/icash_begin_inbound_voice','POST',{
   p_caller:call.caller_id,p_called:call.called_number,p_agent:call.agent_id,p_call_sid:call.call_sid,
   p_conversation:call.conversation_id,p_binding_hash:cap.bindingHash,p_token_hash:cap.hash,p_agent_hash:agentHash,
  });
  if(!result)return NextResponse.json({error:'Call routing unavailable'},{status:409,headers});
  return NextResponse.json(inboundInitiation(result.maxSeconds,cap.token),{headers});
 }catch{return NextResponse.json({error:'Call routing unavailable'},{status:409,headers});}
}
