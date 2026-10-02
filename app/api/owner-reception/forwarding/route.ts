import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {receptionTarget,boundedBody} from '@/lib/general-reception';
import {reviewReceptionForwarding,applyReceptionForwarding} from '@/lib/reception-forwarding';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(status:number)=>NextResponse.json({status:'blocked',message:'Forwarding setup could not be verified.'},{status,headers});
const env=()=>({CONTIGUITY_API_KEY:process.env.CONTIGUITY_API_KEY,CONTIGUITY_FROM:process.env.CONTIGUITY_FROM,TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN,ELEVENLABS_INBOUND_WEBHOOK_SECRET:process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET});
const deps={rpc:(name:string,body?:Record<string,unknown>)=>db('rpc/'+name,'POST',body??{})};
async function guard(request:Request,write=false){const owner=await workAccount();if(owner.accountId!==receptionTarget.accountId||owner.userId!==receptionTarget.ownerUserId)return reply(403);const url=new URL(request.url);if(url.search||url.username||url.password||request.headers.get('host')!==url.host)return reply(400);if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||(write||request.headers.has('origin'))&&request.headers.get('origin')!==url.origin)return reply(403);return null;}
const failed=(e:unknown)=>reply(e instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(e.message)?401:503);
export async function GET(request:Request){try{const blocked=await guard(request);return blocked??NextResponse.json(await reviewReceptionForwarding(env(),deps),{headers});}catch(e){return failed(e);}}
export async function POST(request:Request){try{const blocked=await guard(request,true);if(blocked)return blocked;if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415);let value:unknown;try{value=JSON.parse(await boundedBody(request,4096));}catch{return reply(400);}if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='confirm,reviewToken')return reply(400);const b=value as {confirm:unknown;reviewToken:unknown};if(b.confirm!==true||typeof b.reviewToken!=='string'||b.reviewToken.length>2048)return reply(400);return NextResponse.json(await applyReceptionForwarding(env(),deps,b.reviewToken),{headers});}catch(e){return failed(e);}}
