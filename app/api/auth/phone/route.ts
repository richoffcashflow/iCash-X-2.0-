import {cookies} from 'next/headers';
import {after} from 'next/server';
import {db} from '@/lib/stripe-test';
import {authRequest} from '@/lib/account-auth';
import {allowedOrigin,normalizeEmail} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {normalizeAccessPhone,phoneAccessReady,phoneChallengeCookie,phoneSessionCookie,requestPurchasePhoneCode,verifyPurchasePhoneCode} from '@/lib/purchase-phone-access';
const headers={'Cache-Control':'private, no-store'};
const options={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/'};
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Open iCash X directly and try again.'},{status:403,headers});
 if(!phoneAccessReady())return Response.json({error:'Text sign-in is temporarily unavailable. Use email or contact support.'},{status:503,headers});
 try{
  const raw=await req.text();if(raw.length>1024)return Response.json({error:'Check your email and checkout phone.'},{status:400,headers});
  const body=JSON.parse(raw),email=normalizeEmail(body.email),phone=normalizeAccessPhone(body.phone);
  if(!email||!phone||!['send','verify'].includes(body.action))return Response.json({error:'Enter your payment email and the mobile number used at checkout.'},{status:400,headers});
  const jar=await cookies();
  if(body.action==='send'){
   if(body.accepted!==true)return Response.json({error:'Choose Text me a code to request a sign-in text.'},{status:400,headers});
   await limitRequest(req,'phone-signin',phone,3,600);
   const result=await requestPurchasePhoneCode({db,email,phone,priorChallenge:jar.get(phoneChallengeCookie)?.value,schedule:after});
   jar.set(phoneChallengeCookie,result.cookie,{...options,maxAge:600});
   return Response.json({sent:true,retryAfter:60,message:'If these details match an eligible purchase, a text code is on its way. You can also use your email code.'},{headers});
  }
  await limitRequest(req,'phone-verify',phone,8,600);
  const session=await verifyPurchasePhoneCode({db,auth:authRequest,email,phone,challenge:jar.get(phoneChallengeCookie)?.value??'',code:typeof body.code==='string'?body.code:''});
  // Remove any other identity before setting the verified purchase session.
  jar.delete('icash_access');jar.delete('icash_refresh');jar.delete('__Host-icash_dashboard');jar.delete(phoneChallengeCookie);
  jar.set(phoneSessionCookie,session,{...options,maxAge:86400*30});
  return Response.json({signedIn:true},{headers});
 }catch(error){
  const limited=(error as {status?:number})?.status===429;
  const message=limited?'A code may already be on its way. Enter it below, use email, or wait 10 minutes before requesting another text.':error instanceof Error&&/code|purchase|payment|account/.test(error.message)?error.message:'Text sign-in could not finish. You can still enter a code you received or use email.';
  console.warn('[purchase-phone-access]',{outcome:limited?'rate_limited':'incomplete'});
  return Response.json({error:message},{status:limited?429:400,headers:{...headers,...(limited?{'Retry-After':'600'}:{})}});
 }
}
