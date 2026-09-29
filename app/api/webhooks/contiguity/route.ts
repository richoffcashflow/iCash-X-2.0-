import {NextResponse} from 'next/server';
import {verifyContiguityWebhook,parseTextWebhook} from '@/lib/contiguity';
import {db} from '@/lib/stripe-test';
import {ownerPracticeReply} from '@/lib/owner-practice-replies';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 const secret=process.env.CONTIGUITY_WEBHOOK_SECRET;if(!secret)return new Response(null,{status:503});
 const raw=Buffer.from(await req.arrayBuffer());if(raw.length>262144)return new Response(null,{status:413});
 if(!verifyContiguityWebhook(raw,req.headers.get('contiguity-signature'),secret))return new Response(null,{status:401});
 let event;try{event=parseTextWebhook(JSON.parse(raw.toString('utf8')));}catch{return NextResponse.json({error:'Unsupported or malformed event'},{status:400});}
 try{
 const inbound=event.type.startsWith('text.incoming');const sender=inbound?event.data.to:event.data.from;
 const known=await db<{phone:string}[]>(`icash_text_senders?phone=eq.${encodeURIComponent(sender)}&select=phone`);if(!known.length)return new Response(null,{status:400});
 await db('rpc/icash_ingest_text_event','POST',{p_event:event,p_optout:event.optOut});
 if(inbound)await ownerPracticeReply(event.id);
 return NextResponse.json({received:true});
 }catch{return new Response(null,{status:503});}
}
