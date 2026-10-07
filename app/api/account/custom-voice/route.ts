import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {customVoiceStatus,createCustomVoice} from '@/lib/custom-voice';
import {maxVoiceSampleBytes,ownVoiceConsentVersion} from '@/lib/custom-voice-policy';
export const runtime='nodejs';
export const maxDuration=90;
const headers={'Cache-Control':'private, no-store'};
export async function GET(){try{const {accountId}=await workAccount({allowInactiveMembership:true});return NextResponse.json(await customVoiceStatus(accountId),{headers});}catch{return NextResponse.json({error:'Sign in and refresh to load your voice.'},{status:401,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();
  if(await db<boolean>('rpc/icash_vip_active','POST',{p_account:accountId})!==true)return NextResponse.json({error:'Custom voice is included with VIP.'},{status:403,headers});
  await limitRequest(req,'custom-voice-upload',accountId,5,86400);
  // Bound the body before parsing multipart, including requests without Content-Length.
  if(!req.body)throw Error('Choose an audio recording.');const reader=req.body.getReader(),parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxVoiceSampleBytes+32768){await reader.cancel();throw Error('Use an audio recording under 4 MB.');}parts.push(value);}
  const raw=new Uint8Array(size);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.byteLength;}
  const form=await new Response(raw,{headers:{'Content-Type':req.headers.get('content-type')??''}}).formData();
  const sample=form.get('sample');if(!(sample instanceof File)||form.getAll('sample').length!==1||form.get('consent')!==ownVoiceConsentVersion)throw Error('Choose your recording and confirm it is your own voice.');
  return NextResponse.json(await createCustomVoice(accountId,userId,new Uint8Array(await sample.arrayBuffer()),ownVoiceConsentVersion),{headers});
 }catch(e){const message=e instanceof Error?e.message:'';return NextResponse.json({error:message&&message!=='Database request failed'&&!message.startsWith('VOICE_')?message:'Could not confirm your voice. Refresh its status before retrying.'},{status:409,headers});}
}
export async function PATCH(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const {accountId,userId}=await workAccount({allowInactiveMembership:true});const raw=await req.text();if(raw.length>100)throw Error();const data=JSON.parse(raw);if(typeof data.enabled!=='boolean'||Object.keys(data).length!==1)throw Error();await db('rpc/icash_set_custom_voice_enabled','POST',{p_user:userId,p_account:accountId,p_enabled:data.enabled});return NextResponse.json(await customVoiceStatus(accountId),{headers});}catch{return NextResponse.json({error:'Could not change your voice. Refresh and try again.'},{status:409,headers});}
}
