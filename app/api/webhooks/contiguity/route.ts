import {NextResponse} from 'next/server';
import {verifyContiguityWebhook,parseTextWebhook} from '@/lib/contiguity';
import {db} from '@/lib/stripe-test';
import {ownerPracticeReply} from '@/lib/owner-practice-replies';
import {replyToSellerText} from '@/lib/seller-text-replies';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {processTextAi} from '@/lib/text-ai-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 const secret=process.env.CONTIGUITY_WEBHOOK_SECRET;if(!secret)return new Response(null,{status:503});
 const raw=Buffer.from(await req.arrayBuffer());if(raw.length>262144)return new Response(null,{status:413});
 if(!verifyContiguityWebhook(raw,req.headers.get('contiguity-signature'),secret))return new Response(null,{status:401});
 let event;try{event=parseTextWebhook(JSON.parse(raw.toString('utf8')));}catch{return NextResponse.json({error:'Unsupported or malformed event'},{status:400});}
 try{
 const inbound=event.type.startsWith('text.incoming');const sender=inbound?event.data.to:event.data.from;
 const [known,campaign]=await Promise.all([db<{phone:string}[]>(`icash_text_senders?phone=eq.${encodeURIComponent(sender)}&select=phone`),db<{phone:string}[]>(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(sender)}&select=phone`)]);if(!known.length&&!campaign.length)return new Response(null,{status:400});
 const role=inbound?await db<string>('rpc/icash_route_lifecycle_text','POST',{p_event:event,p_optout:event.optOut}):null;

 if(['text.delivery.confirmed','text.delivery.failed','text.cancelled'].includes(event.type))await db('rpc/icash_webinar_followup_delivery','POST',{p_channel:'sms',p_provider:event.data.message_id,p_kind:event.type==='text.delivery.confirmed'?'delivered':'failed'});
 if(inbound&&role!=='property')return NextResponse.json({received:true});
 if(event.type==='numbers.substitution')await db(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(event.data.from)}`,'PATCH',{enabled:false});
 if(!known.length)return NextResponse.json({received:true});
 await db('rpc/icash_ingest_text_event','POST',{p_event:event,p_optout:event.optOut});
 if(inbound&&!event.optOut){
  // Queuing is idempotent and provider claims are atomic. A failed immediate
  // attempt remains durable for the automation worker; never replay a send.
  try{await replyToSellerText(db,dispatchTextMessage,event.id,processTextAi,dispatchLiveVoice);}catch{/* Durable queue is retried only before provider claim. */}
  await ownerPracticeReply(event.id);
 }
 return NextResponse.json({received:true});
 }catch{return new Response(null,{status:503});}
}
