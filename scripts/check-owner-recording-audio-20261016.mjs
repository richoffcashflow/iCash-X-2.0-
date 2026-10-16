// Scoped read-only provider check for the owner's reported missing call audio.
// Store only metadata in the existing private diagnostics table; never log audio or credentials.
import {createRecordingProviders,boundedBytes} from '../lib/required-call-recording-provider.ts';
const accountId='48dfb798-8c1a-404f-88c0-c396cc067062';
const recordingId='a9a83042-8b4f-4dbc-87d5-a0046cfb42b7';
const checkName='owner_recording_audio_20261016';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>Date.parse('2026-10-17T06:00:00Z'))process.exit(0);
try{
 const env=process.env;
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('CONFIGURATION_REQUIRED');
 async function db(path,method='GET',body){
  const response=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('DIAGNOSTIC_STORE_UNAVAILABLE');
  return response.status===204||response.headers.get('content-length')==='0'?null:JSON.parse((await boundedBytes(response,262144)).toString('utf8'));
 }
 const prior=await db('icash_integration_checks?provider=eq.'+checkName+'&select=result');
 if(prior[0]?.result?.mediaReadable===true){console.log('Requested call audio: readback already confirmed.');process.exit(0);}
 const [row]=await db('icash_call_recordings?id=eq.'+recordingId+'&account_id=eq.'+accountId+'&select=id,account_id,call_sid,recording_sid,provider_account_sid,state,provider_started_at,call_ended_at,entry_policy,recording_authorized_at,consent_at');
 if(row?.id!==recordingId||row.account_id!==accountId||row.call_sid!=='CA85e9d0ca8fef3161ef439d93a4a23e01'||row.recording_sid!=='REc53d553574f0ed9e8bafc5cdef5186d1'||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID)throw Error('RECORDING_BINDING_REQUIRED');
 const provider=createRecordingProviders(env);
 const receipt=await provider.getRecording(row.recording_sid);
 if(receipt.sid!==row.recording_sid||receipt.call_sid!==row.call_sid||receipt.account_sid!==row.provider_account_sid)throw Error('PROVIDER_BINDING_REQUIRED');
 const safeValue=value=>typeof value==='string'||typeof value==='number'||value===null?value:null;
 const result={accountId,recordingId,state:row.state,storedStartTime:row.provider_started_at,callEndedAt:row.call_ended_at,entryPolicy:row.entry_policy,recordingAuthorized:!!(row.recording_authorized_at||row.consent_at),
  provider:{status:safeValue(receipt.status),startTime:safeValue(receipt.start_time),duration:safeValue(receipt.duration),price:safeValue(receipt.price),priceUnit:safeValue(receipt.price_unit),recordingSid:receipt.sid,callSid:receipt.call_sid},mediaReadable:false,mediaBytes:null,mediaCheck:null};
 if(receipt.status==='completed'){
  try{const media=await provider.media(row.recording_sid);result.mediaReadable=media.length>0;result.mediaBytes=media.length;result.mediaCheck=media.length>0?'audio_mpeg_received':'empty_media';}
  catch{result.mediaCheck='provider_media_read_unavailable';}
 }
 await db('icash_integration_checks?on_conflict=provider','POST',{provider:checkName,checked_at:new Date().toISOString(),result});
 console.log('Requested call audio: provider readback saved. No call placed.');
}catch{console.log('Requested call audio: readback unavailable. No call placed.');}
