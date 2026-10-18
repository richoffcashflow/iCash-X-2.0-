import {after} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {verifyMetaSignature,metaNotices} from '@/lib/meta-instant-leads';
import {instantLeadsEnabled,retrieveInstantLead} from '@/lib/meta-instant-lead-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'no-store'};
export async function GET(req:Request){
 const p=new URL(req.url).searchParams,token=p.get('hub.verify_token')??'',expected=process.env.META_LEAD_VERIFY_TOKEN??'';
 // Meta must be able to verify this production callback before intake is
 // activated. This challenge cannot retrieve a lead or start outreach.
 if(process.env.VERCEL_ENV!=='production'||!process.env.META_LEAD_APP_SECRET||!expected||p.get('hub.mode')!=='subscribe'||Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return new Response(null,{status:403,headers});
 const challenge=p.get('hub.challenge');return challenge&&/^\d{1,100}$/.test(challenge)?new Response(challenge,{headers}):new Response(null,{status:400,headers});
}
export async function POST(req:Request){
 if(!instantLeadsEnabled(process.env))return new Response(null,{status:503,headers});
 const raw=Buffer.from(await req.arrayBuffer());if(raw.length>262144)return new Response(null,{status:413,headers});
 if(!verifyMetaSignature(raw,req.headers.get('x-hub-signature-256'),process.env.META_LEAD_APP_SECRET))return new Response(null,{status:401,headers});
 let notices;try{notices=metaNotices(JSON.parse(raw.toString('utf8')));}catch{return new Response(null,{status:400,headers});}
 try{
  for(const notice of notices)await db('rpc/icash_meta_receive_notice','POST',{p_notice:notice});
  // Acknowledge only after durable storage, then wake the same recovery worker.
  after(async()=>{try{await Promise.allSettled(notices.slice(0,4).map(()=>retrieveInstantLead({db,sms:dispatchTextMessage,voice:dispatchLiveVoice,env:process.env})));}catch{console.warn('meta_instant_lead_work_pending');}});
  return Response.json({received:true},{headers});
 }catch{return new Response(null,{status:503,headers});}
}
