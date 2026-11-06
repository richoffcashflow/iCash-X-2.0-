import {replyToInstantLeadText} from '@/lib/meta-instant-text';
import {NextResponse} from 'next/server';
import {verifyContiguityWebhook,parseTextWebhook,parseSenderDelay,isServiceTextSender} from '@/lib/contiguity';
import {suppressCarrierBlockedSms} from '@/lib/carrier-blocked-sms';
import {db} from '@/lib/stripe-test';
import {ownerPracticeReply} from '@/lib/owner-practice-replies';
import {replyToSellerText} from '@/lib/seller-text-replies';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {processTextAi} from '@/lib/text-ai-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
export const runtime='nodejs';
export const maxDuration=60;
async function recordIngressFailure(kind:string,stage:string){
 // Separate bounded diagnostic write. Never include source content or replay work.
 try{await db('rpc/icash_record_text_ingress_failure','POST',{p_kind:kind,p_stage:stage},AbortSignal.timeout(1000));}
 catch{console.warn('text_webhook_monitoring_failed');}
}
export async function POST(req:Request){
 const secret=process.env.CONTIGUITY_WEBHOOK_SECRET;if(!secret)return new Response(null,{status:503});
 const raw=Buffer.from(await req.arrayBuffer());if(raw.length>262144)return new Response(null,{status:413});
 if(!verifyContiguityWebhook(raw,req.headers.get('contiguity-signature'),secret))return new Response(null,{status:401});
 let input:unknown,parsed;
 try{
  input=JSON.parse(raw.toString('utf8'));
  parsed=input&&typeof input==='object'&&'type' in input&&input.type==='numbers.delayed'
   ?{kind:'delay' as const,event:parseSenderDelay(input)}
   :{kind:'message' as const,event:parseTextWebhook(input)};
 }catch{
  const type=input&&typeof input==='object'&&'type' in input?input.type:null;
  const incomingTypes=['text.incoming.sms','text.incoming.mms','communications.incoming.sms','communications.incoming.mms','communications.incoming.imessage','imessage.incoming'];
  const eventClass=typeof type==='string'&&incomingTypes.includes(type)?'incoming':'other_or_unknown';
  console.warn('text_webhook_rejected',{reason:'unsupported_or_malformed',eventClass});
  await recordIngressFailure('authenticated_rejected',eventClass==='incoming'?'parse_incoming':'parse_other');
  return NextResponse.json({error:'Unsupported or malformed event'},{status:400});
 }
 let stage='sender_registration';
 try{
 const inbound=parsed.kind==='message'&&parsed.event.type.startsWith('text.incoming');
 const sender=parsed.kind==='delay'?parsed.event.data.original_number:inbound?parsed.event.data.to:parsed.event.data.from;
 const [known,campaign]=await Promise.all([db<{phone:string}[]>(`icash_text_senders?phone=eq.${encodeURIComponent(sender)}&select=phone`),db<{phone:string}[]>(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(sender)}&select=phone`)]);if(!known.length&&!campaign.length){console.warn('text_webhook_rejected',{reason:'unregistered_destination'});await recordIngressFailure('unregistered_destination','sender_registration');return new Response(null,{status:400});}
 if(parsed.kind==='delay'){
  stage='delivery_receipt';
  // The existing inbox deduplicates by event ID. A delay only records the notice.
  await db('rpc/icash_ingest_text_event','POST',{p_event:parsed.event,p_optout:false});
  return NextResponse.json({received:true});
 }
 const event=parsed.event;
 // Acknowledge authenticated service notices after checking our destination.
 // Never persist verification codes or route short codes into customer work.
 if(inbound&&isServiceTextSender(event.data.from))return NextResponse.json({received:true});
 stage='lifecycle_routing';
 const role=inbound?await db<string>('rpc/icash_route_lifecycle_text','POST',{p_event:event,p_optout:event.optOut}):null;
 if(inbound)await db('rpc/icash_legacy_reply','POST',{p_phone:event.data.from,p_optout:event.optOut});

 if(['text.delivery.confirmed','text.delivery.failed','text.cancelled'].includes(event.type)){
  stage='delivery_receipt';
  const blocked=await suppressCarrierBlockedSms(db,event);
  await db('rpc/icash_webinar_followup_delivery','POST',{p_channel:'sms',p_provider:event.data.message_id,p_kind:blocked?'suppressed':event.type==='text.delivery.confirmed'?'delivered':'failed'});
  await db('rpc/icash_legacy_delivery','POST',{p_channel:'sms',p_provider:event.data.message_id,p_kind:blocked?'suppressed':event.type==='text.delivery.confirmed'?'delivered':'failed'});
 }
 if(inbound&&role!=='property')return NextResponse.json({received:true});
 stage='property_ingestion';
 if(event.type==='numbers.substitution')await db(`icash_webinar_text_senders?phone=eq.${encodeURIComponent(event.data.from)}`,'PATCH',{enabled:false});
 if(!known.length)return NextResponse.json({received:true});
 await db('rpc/icash_ingest_text_event','POST',{p_event:event,p_optout:event.optOut});
 if(inbound&&!event.optOut){
  stage='reply_preparation';
  if(await replyToInstantLeadText({db,sms:dispatchTextMessage,voice:dispatchLiveVoice,env:process.env},event.id))return NextResponse.json({received:true});
  // Queuing is idempotent and provider claims are atomic. A failed immediate
  // attempt remains durable for the automation worker; never replay a send.
  try{await replyToSellerText(db,dispatchTextMessage,event.id,processTextAi,dispatchLiveVoice);}catch{console.warn('text_webhook_reply_deferred');/* Durable queue is retried only before provider claim. */}
  await ownerPracticeReply(event.id);
 }
 return NextResponse.json({received:true});
 }catch{console.warn('text_webhook_processing_failed',{stage});await recordIngressFailure('processing_failed',stage);return new Response(null,{status:503});}
}
