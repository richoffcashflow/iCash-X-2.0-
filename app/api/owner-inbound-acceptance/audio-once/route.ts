import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {isAudioOwner,ownerAudioOnceConfirmation} from '@/lib/owner-audio-once';
import {audioOnceStatus,armAudioOnce,cancelAudioOnce,reconcileAudioOnceRun} from '@/lib/owner-audio-once-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(status:string,code:number)=>NextResponse.json({status},{status:code,headers});
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('arm'),confirmation:z.literal(ownerAudioOnceConfirmation),configHash:z.string().regex(/^[a-f0-9]{64}$/),versionId:z.string().regex(/^agtvrsn_[A-Za-z0-9]+$/)}).strict(),
 z.object({action:z.literal('cancel')}).strict(),z.object({action:z.literal('reconcile')}).strict(),
]);
function requestAllowed(req:Request,write=false){const u=new URL(req.url);return !u.search&&req.headers.get('host')===u.host&&['same-origin','none',null].includes(req.headers.get('sec-fetch-site'))&&(write?req.headers.get('origin')===u.origin:!req.headers.has('origin')||req.headers.get('origin')===u.origin);}
function failure(e:unknown){
 const key=e instanceof Error?e.message:'';
 const reasons:Record<string,string>={AUDIO_TWILIO_ACCOUNT_MISSING:'twilio_account_missing',AUDIO_TWILIO_ACCOUNT_INVALID:'twilio_account_invalid',AUDIO_TWILIO_READ_UNAVAILABLE:'twilio_read_unavailable',AUDIO_TWILIO_RECEIPT_MISMATCH:'twilio_receipt_mismatch',AUDIO_PRIVATE_AGENT_READ_UNAVAILABLE:'private_agent_read_unavailable',AUDIO_BRANCH_READ_UNAVAILABLE:'branch_read_unavailable',AUDIO_PHONE_READ_UNAVAILABLE:'phone_read_unavailable',AUDIO_MAIN_READ_UNAVAILABLE:'main_read_unavailable',SIGN_IN_REQUIRED:'sign_in_required',ACCOUNT_REQUIRED:'sign_in_required',AUDIO_NOT_CONFIGURED:'twilio_account_configuration_unavailable','Database not configured':'database_configuration_unavailable','Database request failed':'database_access_unavailable',OWNER_INBOUND_PROVIDER_UNAVAILABLE:'provider_unavailable',OWNER_INBOUND_PROVIDER_RECEIPT_INVALID:'provider_receipt_invalid',OWNER_INBOUND_PROVIDER_CREDENTIALS_UNAVAILABLE:'provider_credentials_unavailable',OWNER_INBOUND_PROVIDER_CONFIG_INVALID:'provider_configuration_invalid',AUDIO_REVIEW_CHANGED:'provider_review_changed',AUDIO_ALREADY_CONSUMED:'test_already_consumed',AUDIO_ARM_UNCONFIRMED:'arm_outcome_unknown'};
 const raw=process.env.TWILIO_ACCOUNT_SID,configurationDiagnostics=['AUDIO_TWILIO_ACCOUNT_MISSING','AUDIO_TWILIO_ACCOUNT_INVALID'].includes(key)?{present:typeof raw==='string'&&raw.length>0,rawLength:raw?.length??0,trimmedLength:raw?.trim().length??0}:undefined;
 return NextResponse.json({status:'held',canArm:false,...(configurationDiagnostics?{configurationDiagnostics}:{}),reason:Object.hasOwn(reasons,key)?reasons[key]:'readiness_unavailable'},{status:['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(key)?401:503,headers});
}
export async function GET(req:Request){try{const o=await workAccount();if(!isAudioOwner(o))return reply('owner_required',403);if(!requestAllowed(req))return reply('invalid_request',403);return NextResponse.json(await audioOnceStatus(o),{headers});}catch(e){return failure(e);}}
export async function POST(req:Request){
 try{
  const o=await workAccount();if(!isAudioOwner(o))return reply('owner_required',403);if(!requestAllowed(req,true))return reply('invalid_request',403);
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply('json_required',415);
  const length=req.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>2048))return reply('invalid_request',400);
  if(!req.body)return reply('invalid_request',400);
  const reader=req.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>2048){await reader.cancel();return reply('invalid_request',400);}parts.push(r.value);}}finally{reader.releaseLock();}
  let raw:unknown;try{raw=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return reply('invalid_request',400);}
  const parsed=schema.safeParse(raw);if(!parsed.success)return reply('invalid_request',400);
  const b=parsed.data,result=b.action==='arm'?await armAudioOnce(o,b.configHash,b.versionId):b.action==='cancel'?await cancelAudioOnce(o):await reconcileAudioOnceRun(o);
  return NextResponse.json(result,{headers});
 }catch(e){return failure(e);}
}
