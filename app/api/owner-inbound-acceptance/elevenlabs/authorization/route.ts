import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {prepareOwnerElevenLabsAuthorization,applyOwnerElevenLabsAuthorization} from '@/lib/owner-elevenlabs-authorization';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const response=(status:string,code:number)=>NextResponse.json({status},{status:code,headers});
const environment=()=>({ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,ELEVENLABS_INBOUND_WEBHOOK_SECRET:process.env.ELEVENLABS_INBOUND_WEBHOOK_SECRET});
async function owner(){const value=await workAccount();return value.accountId===ownerInboundTarget.accountId&&value.userId===ownerInboundTarget.ownerUserId;}
function failure(error:unknown){return response(error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message)?'sign_in_required':'authorization_repair_unavailable',error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message)?401:503);}
function fixedRequest(request:Request){const url=new URL(request.url);return !url.search&&!url.username&&!url.password&&request.headers.get('host')===url.host;}
export async function GET(request:Request){
 try{
  if(!await owner())return response('owner_required',403);
  if(!fixedRequest(request))return response('fixed_target_only',400);
  if(!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||(request.headers.has('origin')&&request.headers.get('origin')!==new URL(request.url).origin))return response('same_origin_required',403);
  return NextResponse.json(await prepareOwnerElevenLabsAuthorization(environment()),{headers});
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
  let body:unknown;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return response('invalid_request',400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'reviewToken')||typeof (body as {reviewToken:unknown}).reviewToken!=='string'||(body as {reviewToken:string}).reviewToken.length>2048)return response('invalid_request',400);
  return NextResponse.json(await applyOwnerElevenLabsAuthorization(environment(),(body as {reviewToken:string}).reviewToken),{headers});
 }catch(error){return failure(error);}
}
