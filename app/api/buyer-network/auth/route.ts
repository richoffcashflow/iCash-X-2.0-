import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authRequest,saveSession} from '@/lib/account-auth';
import {limitRequest} from '@/lib/funding';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('send'),email:z.string().trim().toLowerCase().email().max(320)}).strict(),
 z.object({action:z.literal('verify'),email:z.string().trim().toLowerCase().email().max(320),code:z.string().regex(/^\d{6,10}$/)}).strict(),
]);
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Open this page directly and try again.'},{status:403,headers});
 if(process.env.ICASH_AUTH_EMAIL_READY!=='true')return NextResponse.json({error:'Email verification is temporarily unavailable.'},{status:503,headers});
 try{
  const raw=await req.text();if(raw.length>1000)throw Error('Too long');
  const input=schema.parse(JSON.parse(raw));
  await limitRequest(req,`network-${input.action}`,input.email,input.action==='send'?3:8,input.action==='send'?3600:600);
  if(input.action==='send'){
   await authRequest('otp',{email:input.email,create_user:true});
   return NextResponse.json({sent:true},{headers});
  }
  const session=await authRequest<{access_token:string;refresh_token:string;expires_in:number;user:{id:string;email?:string;email_confirmed_at?:string}}>('verify',{email:input.email,token:input.code,type:'email'});
  if(!session.user.email_confirmed_at)throw Error('Email not verified');
  // Buyer enrollment is free: do not claim funding, create a membership or grant VIP.
  await saveSession(session);
  return NextResponse.json({signedIn:true},{headers});
 }catch{return NextResponse.json({error:'Could not verify this request. Check your code or wait before requesting another.'},{status:400,headers});}
}
