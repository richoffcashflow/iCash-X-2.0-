import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {verifyTitleWebhook,titleEmailAddress,titleReference} from '@/lib/title-inbound-policy';
export const runtime='nodejs';
export async function POST(req:Request){
 const secret=process.env.RESEND_RECEIVING_WEBHOOK_SECRET,mailbox=titleEmailAddress(process.env.ICASH_TITLE_REPLY_EMAIL);
 if(!secret||!mailbox||!process.env.RESEND_API_KEY)return NextResponse.json({error:'Receiving not configured'},{status:503});
 let event;
 try{const body=await req.text();if(Buffer.byteLength(body)>262144)return new Response(null,{status:413});event=verifyTitleWebhook(body,req.headers,secret);}catch{return new Response(null,{status:400});}
 if(event.type!=='email.received')return NextResponse.json({received:true});
 const id=event.data?.email_id;if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return new Response(null,{status:400});
 try{
 const prior=await db<{id:string}[]>(`icash_title_replies?provider_email_id=eq.${id}&select=id&limit=1`);if(prior.length)return NextResponse.json({received:true});
 const res=await fetch(`https://api.resend.com/emails/receiving/${id}`,{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('Receiving temporarily unavailable');const email=await res.json();
 if(email.id!==id||!Array.isArray(email.to)||!email.to.some((v:unknown)=>titleEmailAddress(v)===mailbox))return NextResponse.json({received:true});
 const reference=titleReference(email.subject);if(!reference)return NextResponse.json({received:true});
 const sender=titleEmailAddress(email.from);if(!sender)return new Response(null,{status:400});
 await db('rpc/icash_record_title_reply','POST',{p_email:id,p_kind:reference.kind,p_reference:reference.id,p_sender:sender,p_subject:String(email.subject).slice(0,500),p_text:typeof email.text==='string'?email.text.slice(0,20000):'No plain-text body. Review the original message in the receiving inbox.',p_authenticated:email.authentication?.dmarc==='pass'});
 return NextResponse.json({received:true});
 }catch{return NextResponse.json({error:'Retry required'},{status:503});}
}
