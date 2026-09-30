import {NextResponse} from 'next/server';
import {fundingMode} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {verifyTitleWebhook,titleEmailAddress} from '@/lib/title-inbound-policy';
import {isCancelEmail,supportId} from '@/lib/support-policy';
export const runtime='nodejs';
/** Request intake only: no AI, email sending, billing action, deletion or account change. */
export async function POST(req:Request){
 const secret=process.env.ICASH_SUPPORT_EMAIL_WEBHOOK_SECRET,mailbox=titleEmailAddress(process.env.ICASH_SUPPORT_EMAIL),mode=fundingMode();
 if(!secret||!mailbox||!process.env.RESEND_API_KEY||!mode)return NextResponse.json({error:'Receiving unavailable'},{status:503});
 let event;
 try{const raw=await req.text();if(Buffer.byteLength(raw)>65536)return new Response(null,{status:413});event=verifyTitleWebhook(raw,req.headers,secret);}catch{return new Response(null,{status:400});}
 if(event.type!=='email.received')return NextResponse.json({received:true});
 const parsed=supportId.safeParse(event.data?.email_id);if(!parsed.success)return new Response(null,{status:400});
 try{
  const r=await fetch(`https://api.resend.com/emails/receiving/${parsed.data}`,{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const email=await r.json();
  if(email.id!==parsed.data||!Array.isArray(email.to)||!email.to.some((to:unknown)=>titleEmailAddress(to)===mailbox)||!isCancelEmail(email.subject))return NextResponse.json({received:true});
  const sender=titleEmailAddress(email.from);if(!sender)return NextResponse.json({received:true});
  // Matching sender is just a routing hint. Only an authenticated owner can consume a signed confirmation.
  await db('rpc/icash_support_request_email_cancel','POST',{p_email:sender,p_provider:parsed.data,p_mode:mode});
  return NextResponse.json({received:true});
 }catch{return NextResponse.json({error:'Retry required'},{status:503});}
}
