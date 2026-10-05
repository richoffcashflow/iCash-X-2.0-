import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes,createHash} from 'node:crypto';
import {db,guestHash} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest,validGuest} from '@/lib/funding';
import {sellerSubmission,sellerConsentText,sellerSharingText,sellerDuplicateKeyInput} from '@/lib/seller-leads';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Open the property form directly and try again.'},{status:403,headers});
 try{
  const body=await req.text();if(body.length>3000)throw Error();const p=sellerSubmission.safeParse(JSON.parse(body));if(!p.success)return NextResponse.json({error:'Check your contact details and accept the contact agreement.'},{status:400,headers});const i=p.data;
  if(i.honeypot)return NextResponse.json({received:true,message:'Your request has been received.'},{headers});
  const jar=await cookies();let token=jar.get('keypath_seller')?.value;if(!validGuest(token)){token=randomBytes(32).toString('hex');jar.set('keypath_seller',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}
  await limitRequest(req,'seller-intake',token,5,3600);
  const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
  await db('rpc/icash_submit_seller_contact_intake','POST',{p_request:i.requestId,p_guest:guestHash(token),p_name:i.name,p_address:i.address,p_phone:i.phone,p_email:i.email,p_duplicate:hash(sellerDuplicateKeyInput(i.address,i.phone)),p_consented:i.consented,p_consent_version:i.consentVersion,p_consent_text:sellerConsentText,p_sharing_text:sellerSharingText,p_attribution:{source:i.source,campaign:i.campaign,clickId:i.clickId,measurementOptOut:req.headers.get('sec-gpc')==='1'},p_agent_hash:guestHash(req.headers.get('user-agent')||'unknown')});
  // A persisted request is not a qualified lead or a promise that a call was made.
  return NextResponse.json({received:true,message:'Your property request is saved. We’ll review the address and available options. No offer has been made yet.'},{headers});
 }catch{return NextResponse.json({error:'We couldn’t confirm your submission. Please wait a moment and retry with the same details.'},{status:503,headers});}
}
