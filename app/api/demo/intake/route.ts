import {after} from 'next/server';
import {cookies} from 'next/headers';
import {createHash,randomBytes} from 'node:crypto';
import {dashboardCurrentUser as currentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db,guestHash} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest,validGuest} from '@/lib/funding';
import {botDemoSubmission} from '@/lib/bot-demo';
import {sellerDuplicateKeyInput} from '@/lib/seller-leads';
import {processSellerIntake} from '@/lib/seller-pipeline';
import {processSellerResponses} from '@/lib/seller-response-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
import {sellerSubmissionStatus} from '@/lib/seller-submission-status';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
async function presenter(){const user=await currentUser(true);return user?.id===ownerInboundTarget.ownerUserId?user:null;}
export async function GET(){
 try{
  const user=await presenter();
  // Readiness establishes the guest binding before a POST can be committed.
  // Losing a POST response must not also lose its only Set-Cookie receipt.
  if(user){const jar=await cookies();if(!validGuest(jar.get('keypath_seller')?.value))
   jar.set('keypath_seller',randomBytes(32).toString('hex'),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}
  return Response.json({ready:!!user,privateDemoPhone:user?ownerInboundTarget.ownerPhone:null},{headers});
 }
 catch{return Response.json({error:'Sign in to your workspace to start the demo.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return Response.json({error:'Open the iCash X demo page and try again.'},{status:403,headers});
 try{
  const user=await presenter();
  if(!user)return Response.json({error:'Sign in to the presenting iCash X account first.'},{status:403,headers});
  const raw=await req.text();if(raw.length>3000)return Response.json({error:'Please check your details.'},{status:400,headers});
  const parsed=botDemoSubmission.safeParse(JSON.parse(raw));
  if(!parsed.success)return Response.json({error:'Enter a full address, valid US phone number, and accept the contact agreement.'},{status:400,headers});
  const i=parsed.data;
  if(i.honeypot)return Response.json({received:true},{headers});
  const jar=await cookies(),token=jar.get('keypath_seller')?.value;
  if(!validGuest(token))return Response.json({error:'Refresh this page to prepare your demo, then try again.'},{status:409,headers});
  // Transport abuse is bounded separately. The atomic RPC charges the original
  // five/hour new-demo buckets only once per validated request identity.
  await limitRequest(req,'bot-demo-attempt',user.id,60,3600);
  const leadId=await db<string>('rpc/icash_submit_limited_bot_demo_intake','POST',{
   p_actor:user.id,p_account:ownerInboundTarget.accountId,p_request:i.requestId,p_guest:guestHash(token),
   p_name:i.name,p_address:i.address,p_phone:i.phone,p_consented:i.consented,
   p_duplicate:createHash('sha256').update('icash-x-demo:'+ownerInboundTarget.accountId+':'+sellerDuplicateKeyInput(i.address,i.phone)).digest('hex'),
   p_timezone:i.contactTimezone??'America/Chicago',p_agent_hash:guestHash(req.headers.get('user-agent')||'unknown'),
   p_ip_hash:guestHash(req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'unknown'),
  });
  const [receipt]=await db<{state:string}[]>(`icash_seller_intakes?id=eq.${leadId}&select=state&limit=1`);
  if(receipt?.state==='duplicate')return Response.json({received:true,progress:sellerSubmissionStatus('duplicate_demo')},{headers});
  if(i.callNowVersion&&receipt&&['received','checking','qualified','assigned'].includes(receipt.state))await db('rpc/icash_request_optin_call_now','POST',{p_lead:leadId,p_request:i.requestId,p_source:'demo_form',p_reference:i.callNowVersion,p_actor:user.id,p_account:ownerInboundTarget.accountId});
  // Only a presenter-submitted opt-in enters the ordinary durable pipeline.
  // Loading, building and verifying this page never start provider work.
  after(async()=>{try{
   await processSellerIntake(db,process.env.DEALMACHINE_API_KEY,fetch,leadId);
   await db('rpc/icash_assign_seller_lead_for','POST',{p_lead:leadId});
   await processSellerResponses(db,dispatchTextMessage,dispatchLiveVoice,leadId);
  }catch{console.error('iCash X demo processing deferred to queue');}});
  return Response.json({received:true,progress:sellerSubmissionStatus('received')},{headers});
 }catch(error){
  if(error instanceof Error&&'status' in error&&error.status===429)
   return Response.json({error:'Too many demo attempts. Please wait before trying again.'},{status:429,headers:{...headers,'Retry-After':'3600'}});
  return Response.json({error:'Could not confirm your submission. Retry with the same details.'},{status:503,headers});
 }
}
