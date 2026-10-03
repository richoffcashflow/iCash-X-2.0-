import {beginAudioOnce} from '@/lib/owner-audio-once-service';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {NextResponse} from 'next/server';
import {inboundAuthorized,inboundCallSchema} from '@/lib/inbound-voice';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
export async function POST(req:Request){
 const headers={'Cache-Control':'private, no-store'};
 const secret=process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET;
 if(!inboundAuthorized(req.headers.get('authorization'),secret))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 try{
  if(Number(req.headers.get('content-length')??0)>4096)throw new Error('Invalid request');
  const raw=await req.text();if(Buffer.byteLength(raw)>4096)throw new Error('Invalid request');
  const call=inboundCallSchema.parse(JSON.parse(raw));
  // This exact owner/ingress pair never falls through to business routing.
  // Its separate release flag does not enable global work or seller permissions.
  if(call.caller_id===ownerInboundTarget.ownerPhone&&call.called_number===ownerInboundTarget.ingressNumber&&call.agent_id===ownerInboundTarget.agentId){
   const result=await beginAudioOnce(call);
   return NextResponse.json(result??{error:'Call routing unavailable'},{status:result?200:409,headers});
  }
  // Legacy customer ingress cannot establish consent-first recording. Do not admit,
  // reserve, or return an AI initiation here, even if an old route row is enabled.
  // New customer ingress must use the separately reviewed recorded-reception route.
  return NextResponse.json({error:'Call routing unavailable'},{status:503,headers});
 }catch{return NextResponse.json({error:'Call routing unavailable'},{status:409,headers});}
}
