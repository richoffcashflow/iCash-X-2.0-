import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {authRequest,saveSession,type AuthSession} from '@/lib/account-auth';
import {allowedOrigin,normalizeEmail} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
import {currentPrivateInvite,privateAccessCookie,privateAccessHeaders} from '@/lib/private-access';
export const runtime='nodejs';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('email'),email:z.string().max(320)}).strict(),
 z.object({action:z.literal('verify'),email:z.string().max(320),code:z.string().regex(/^\d{6,10}$/)}).strict()
]);
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Open iCash X directly and try again.'},{status:403,headers:privateAccessHeaders});
 if(process.env.ICASH_AUTH_EMAIL_READY!=='true')return NextResponse.json({error:'Email sign-in is temporarily unavailable. Please try again shortly.'},{status:503,headers:privateAccessHeaders});
 try{
  const raw=await req.text();if(raw.length>1024)throw Error();
  const body=input.parse(JSON.parse(raw)),email=normalizeEmail(body.email);
  if(!email)return NextResponse.json({error:'Enter a valid email address.'},{status:400,headers:privateAccessHeaders});
  const invite=await currentPrivateInvite();
  if(!invite)return NextResponse.json({error:'Reopen your private invitation link to continue.'},{status:403,headers:privateAccessHeaders});
  await limitRequest(req,`private-access-${body.action}`,email,body.action==='email'?3:8,600);
  if(body.action==='email'){
   await authRequest('otp',{email,create_user:true});
   return NextResponse.json({sent:true},{headers:privateAccessHeaders});
  }
  const session=await authRequest<AuthSession>('verify',{email,token:body.code,type:'email'});
  if(!session.user.email_confirmed_at||normalizeEmail(session.user.email)!==email)throw Error('Email verification required');
  const result=await db<{granted:boolean;reason?:string}>('rpc/icash_redeem_private_invite','POST',{p_hash:invite.hash,p_user:session.user.id,p_mode:invite.mode});
  if(!result.granted)return NextResponse.json({error:'This email already has an account or purchase. Sign in to that account, or use a different email for your new account.'},{status:409,headers:privateAccessHeaders});
  await saveSession(session);
  (await cookies()).delete(privateAccessCookie);
  return NextResponse.json({signedIn:true,url:'/'},{headers:privateAccessHeaders});
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'Check your email and verification code.':'Could not complete this step. Check your code or request a new one and try again.'},{status:400,headers:privateAccessHeaders});}
}
