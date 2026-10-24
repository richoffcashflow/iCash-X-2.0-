import {after} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {sellerPhone} from '@/lib/seller-leads';
import {instantAddress,validInstantLeadToken,hashLeadToken} from '@/lib/meta-instant-leads';
import {instantLeadsEnabled,getInstantLead,queueInstantAddressLink,researchInstantAddress,processInstantLead} from '@/lib/meta-instant-lead-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const token=z.string().max(160);
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('session'),token}).strict(),
 z.object({action:z.literal('save'),token,address:instantAddress}).strict(),
 z.object({action:z.literal('request_link'),requestId:z.guid(),form:z.string().regex(/^[a-z0-9_-]{3,80}$/),phone:z.string().max(30).transform(sellerPhone).refine((p):p is string=>p!==null),address:instantAddress}).strict(),
]);
const deps=()=>({db,sms:dispatchTextMessage,voice:dispatchLiveVoice,env:process.env});
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Open the address form directly and try again.'},{status:403,headers});
 if(!instantLeadsEnabled(process.env))return Response.json({error:'This address form is not available yet.'},{status:503,headers});
 try{
  const raw=await req.text();if(raw.length>3000)throw Error('Invalid request');const p=input.safeParse(JSON.parse(raw));
  if(!p.success)return Response.json({error:'Check the address and include the street, city and two-letter state.'},{status:400,headers});
  const i=p.data;
  if(i.action==='request_link'){
   await limitRequest(req,'instant-address-link',i.phone,3,3600);
   const leadId=await db<string|null>('rpc/icash_meta_request_address_link','POST',{p_request:i.requestId,p_slug:i.form,p_phone:i.phone,p_address:i.address});
   if(leadId)after(async()=>{const lead=await getInstantLead(db,leadId);if(lead)await queueInstantAddressLink(deps(),lead,'address_link','completion');});
   return Response.json({received:true,message:'Check the mobile number you used on Facebook or Instagram for your secure link. Open it to confirm the address.'},{headers});
  }
  if(!validInstantLeadToken(i.token,process.env.META_LEAD_LINK_SECRET))return Response.json({error:'This link has expired or is incomplete. Use the latest text from us.'},{status:401,headers});
  await limitRequest(req,'instant-address',hashLeadToken(i.token),i.action==='session'?60:10,3600);
  const session=await db<{leadId:string;state:string;address:string}|null>('rpc/icash_meta_address_session','POST',{p_hash:hashLeadToken(i.token)});
  if(!session)return Response.json({error:'This request is no longer available.'},{status:410,headers});
  if(i.action==='session')return Response.json({state:session.state,address:session.address},{headers});
  const saved=await db<{status:string}>('rpc/icash_meta_save_address','POST',{p_lead:session.leadId,p_address:i.address,p_channel:'form',p_evidence:'address-link:'+hashLeadToken(i.token)});
  if(saved.status==='unavailable'||saved.status==='review_required'||saved.status==='unmatched')return Response.json({error:saved.status==='unmatched'?'We could not match that address. Check the street, unit, city and state before submitting a correction.':'Your earlier address is already being checked. Reply to your text if it needs a correction.'},{status:409,headers});
  after(async()=>{try{await researchInstantAddress(deps(),session.leadId);await processInstantLead(deps(),session.leadId);}catch{console.warn('instant_address_research_pending');}});
  return Response.json({received:true,message:'Your address is confirmed and attached to your request. We are checking the property details.'},{headers});
 }catch(error){
  const limited=typeof error==='object'&&error!==null&&'status' in error&&error.status===429;
  return Response.json({error:limited?'Please wait before trying again.':'We could not save this yet. Please try again.'},{status:limited?429:503,headers});
 }
}
