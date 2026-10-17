import {cookies} from 'next/headers';
import {randomBytes,createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {normalizeAccessPhone} from '@/lib/purchase-phone-access';
import {accessHelpCookie,accessHelpInput,accessHelpRedact} from '@/lib/access-help';
import {scheduleSupportOwnerNotifications} from '@/lib/support-owner-dispatch';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
const options={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/',maxAge:86400*7};
const valid=(value?:string)=>!!value&&/^[a-f0-9]{64}$/.test(value);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function GET(){
 if(process.env.VERCEL_ENV!=='production')return Response.json({ready:false,conversation:null},{headers});
 try{
  const jar=await cookies();let secret=jar.get(accessHelpCookie)?.value;
  let conversation=valid(secret)?await db<{expired?:boolean}>('rpc/icash_access_help_read','POST',{p_hash:hash(secret!)}):null;
  if(!valid(secret)||conversation?.expired){secret=randomBytes(32).toString('hex');jar.set(accessHelpCookie,secret,options);conversation=null;}
  return Response.json({ready:true,conversation},{headers});
 }catch{return Response.json({error:'Support could not load. Try again or email support@geticashx.com.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Open iCash X directly and try again.'},{status:403,headers});
 if(process.env.VERCEL_ENV!=='production')return Response.json({error:'Use the live iCash X support page.'},{status:503,headers});
 try{
  const raw=await req.text();if(raw.length>5000)return Response.json({error:'Keep your message under 2,000 characters.'},{status:413,headers});
  const parsed=accessHelpInput.safeParse(JSON.parse(raw));if(!parsed.success)return Response.json({error:'Enter your payment email and describe what happened.'},{status:400,headers});
  const i=parsed.data,phone=i.phone?.trim()?normalizeAccessPhone(i.phone):null;
  if(i.phone?.trim()&&!phone)return Response.json({error:'Check your mobile number, including the country code.'},{status:400,headers});
  const jar=await cookies(),secret=jar.get(accessHelpCookie)?.value;
  if(!valid(secret))return Response.json({error:'Refresh this page before sending. Your draft is still here.'},{status:409,headers});
  const key=hash(secret!);await limitRequest(req,'access-help',key,20,3600);
  await db('rpc/icash_access_help_submit','POST',{p_hash:key,p_key:i.requestId,p_email:i.email.toLowerCase(),p_phone:phone,p_message:accessHelpRedact(i.message)});
  const conversation=await db('rpc/icash_access_help_read','POST',{p_hash:key});
  jar.set(accessHelpCookie,secret!,options);scheduleSupportOwnerNotifications();
  return Response.json({saved:true,conversation},{headers});
 }catch(error){
  const limited=(error as {status?:number})?.status===429;
  return Response.json({error:limited?'Please wait before sending another message. Your existing request stays saved.':'We could not confirm your message was saved. Refresh before retrying; your draft is still here.'},{status:limited?429:503,headers});
 }
}
