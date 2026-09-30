import {NextResponse} from 'next/server';
import {fundingMode} from '@/lib/funding-policy';
import {verifyTitleWebhook,titleEmailAddress} from '@/lib/title-inbound-policy';
import {supportId} from '@/lib/support-policy';
import {intakeVerifiedSupportEmail} from '@/lib/support-email-intake';
export const runtime='nodejs';
/** Verified request intake and bounded receipt only: no AI, billing action, deletion or account change. */
export async function POST(req:Request){
 const secret=process.env.ICASH_SUPPORT_EMAIL_WEBHOOK_SECRET,mailbox=titleEmailAddress(process.env.ICASH_SUPPORT_EMAIL),mode=fundingMode();
 if(!secret||!mailbox||!process.env.RESEND_API_KEY||!mode)return NextResponse.json({error:'Receiving unavailable'},{status:503});
 let event;
 try{const raw=await req.text();if(Buffer.byteLength(raw)>65536)return new Response(null,{status:413});event=verifyTitleWebhook(raw,req.headers,secret);}catch{return new Response(null,{status:400});}
 if(event.type!=='email.received')return NextResponse.json({received:true});
 const parsed=supportId.safeParse(event.data?.email_id);if(!parsed.success)return new Response(null,{status:400});
 try{
  const r=await fetch(`https://api.resend.com/emails/receiving/${parsed.data}`,{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const email=await r.json();
  await intakeVerifiedSupportEmail(parsed.data,email);
  return NextResponse.json({received:true});
 }catch{return NextResponse.json({error:'Retry required'},{status:503});}
}
