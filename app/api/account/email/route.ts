import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {authRequest,currentUser} from '@/lib/account-auth';
import {allowedOrigin,normalizeEmail} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Open iCash X directly and try again.'},{status:403,headers});
 try{
  const user=await currentUser(true);if(!user)return NextResponse.json({error:'Sign in to change your email.'},{status:401,headers});
  const raw=await req.text();if(raw.length>1024)return NextResponse.json({error:'Enter a valid email address.'},{status:400,headers});
  let email:string|null;try{const input=JSON.parse(raw);email=normalizeEmail(input.email);if(!email||Object.keys(input).some(key=>key!=='email'))throw Error('Invalid email');}catch{return NextResponse.json({error:'Enter a valid email address.'},{status:400,headers});}
  if(email===user.email?.toLowerCase())return NextResponse.json({email:user.email,pendingEmail:user.new_email??null},{headers});
  if(process.env.ICASH_AUTH_EMAIL_READY!=='true')return NextResponse.json({error:'Email confirmation is temporarily unavailable. Your current email still works.'},{status:503,headers});
  try{await limitRequest(req,'email-change',user.id,3,600);}catch{return NextResponse.json({error:'Wait a few minutes before requesting another email change.'},{status:429,headers});}
  const access=(await cookies()).get('icash_access')?.value;if(!access)return NextResponse.json({error:'Sign in again to change your email.'},{status:401,headers});
  const origin=new URL(process.env.ICASH_APP_ORIGIN??'');if(origin.protocol!=='https:')throw Error('Invalid origin');
  const redirect=new URL('/?settings=account',origin.origin).href;
  // Use the signed-in user's token and the normal confirmation flow, never an admin update.
  const updated=await authRequest<{id:string;email?:string;new_email?:string;email_confirmed_at?:string}>(`user?redirect_to=${encodeURIComponent(redirect)}`,{email},access,'PUT');
  if(updated.id!==user.id)throw Error('Identity mismatch');
  const changed=updated.email?.toLowerCase()===email&&!!updated.email_confirmed_at;
  return NextResponse.json({email:changed?updated.email:user.email,pendingEmail:changed?null:updated.new_email||email},{headers});
 }catch{return NextResponse.json({error:'Could not request the email change. Your current email still works. Please retry.'},{status:503,headers});}
}
