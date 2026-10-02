import {db} from '@/lib/stripe-test';
import {savedAudioPhonePinReview,saveAudioPhonePinReview} from '@/lib/owner-audio-phone-pin-store';
import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {prepareOwnerAudioPhonePin,applyOwnerAudioPhonePin,restoreOwnerAudioPhonePin,inspectOwnerAudioPhonePin,assertPinReviewCurrent} from '@/lib/owner-audio-phone-pin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const response=(status:string,code:number)=>NextResponse.json({status,message:status==='restore_wait_for_call'?'Finish or cancel the test before restoring; an uncertain active call must finish its bounded window.':'The routing operation is held. Use the saved review to check or restore the original assignment.'},{status:code,headers});
function settling(review:{expiresAt?:string|null}){const deadline=Date.parse(review.expiresAt??'')+10_000;return Number.isFinite(deadline)&&Date.now()<deadline;}
const environment=()=>({ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,ELEVENLABS_INBOUND_WEBHOOK_SECRET:process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET});
async function owner(){const value=await workAccount();return value.accountId===ownerInboundTarget.accountId&&value.userId===ownerInboundTarget.ownerUserId;}
function failure(error:unknown){const unauthenticated=error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message);return response(unauthenticated?'sign_in_required':'phone_pin_unavailable',unauthenticated?401:503);}
function fixedRequest(request:Request){const url=new URL(request.url);return !url.search&&!url.username&&!url.password&&request.headers.get('host')===url.host;}
export async function GET(request:Request){
 try{
  if(!await owner())return response('owner_required',403);
  if(!fixedRequest(request))return response('fixed_target_only',400);
  if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||(request.headers.has('origin')&&request.headers.get('origin')!==new URL(request.url).origin))return response('same_origin_required',403);
  const saved=await savedAudioPhonePinReview();
  const review=saved?await inspectOwnerAudioPhonePin(environment(),saved):await prepareOwnerAudioPhonePin(environment());
  return NextResponse.json(saved&&review.status==='restored'&&settling(review)?{...review,status:'outcome_unknown',message:'The original assignment is visible, but the pin request may still be settling. Check again after the short routing review window.'}:review,{headers});
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  if(!await owner())return response('owner_required',403);
  if(!fixedRequest(request))return response('fixed_target_only',400);
  if(request.headers.get('origin')!==new URL(request.url).origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))return response('same_origin_required',403);
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return response('json_required',415);
  const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>4096))return response('invalid_request',400);
  if(!request.body)return response('invalid_request',400);
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return response('invalid_request',400);}parts.push(part.value);}}finally{reader.releaseLock();}
  let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{return response('invalid_request',400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='action,reviewToken')return response('invalid_request',400);
  const input=body as {action:unknown;reviewToken:unknown};
  if(!['pin','restore','inspect'].includes(String(input.action))||typeof input.action!=='string'||typeof input.reviewToken!=='string'||!input.reviewToken.length||input.reviewToken.length>2048)return response('invalid_request',400);
  if(input.action==='pin'){
   assertPinReviewCurrent(environment(),input.reviewToken);
   const run=await db<{id:number}[]>('icash_owner_audio_once?id=eq.1&select=id&limit=1');
   if(run.length)return response('test_already_consumed',409);
   await saveAudioPhonePinReview(input.reviewToken);
  }else if(input.action==='restore'){
   if(await savedAudioPhonePinReview()!==input.reviewToken)return response('saved_review_required',409);
   const current=await inspectOwnerAudioPhonePin(environment(),input.reviewToken);
   if(settling(current))return NextResponse.json({...current,status:'blocked',message:'Wait until the pin review expires plus ten seconds before restoring as a precaution for a pending pin request.'},{status:409,headers});
   if(!await db<boolean>('rpc/icash_start_owner_audio_phone_restore','POST',{p_review_token:input.reviewToken}))return response('restore_wait_for_call',409);
  }
  const action=input.action==='pin'?applyOwnerAudioPhonePin:input.action==='restore'?restoreOwnerAudioPhonePin:inspectOwnerAudioPhonePin;
  const result=await action(environment(),input.reviewToken);
  return NextResponse.json(input.action==='inspect'&&result.status==='restored'&&settling(result)?{...result,status:'outcome_unknown',message:'The original assignment is visible, but the pin request may still be settling. Check again after the short routing review window.'}:result,{headers});
 }catch(error){return failure(error);}
}
