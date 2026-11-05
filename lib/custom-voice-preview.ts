import {db} from './stripe-test.ts';
import {elevenRequest} from './elevenlabs.ts';
import {type CustomVoice,type ProviderCustomVoice,providerVoiceMatches} from './custom-voice-policy.ts';
import {type CustomVoicePreview,customVoicePreviewRequest,maxCustomVoicePreviewBytes,previewAudioValid} from './custom-voice-preview-policy.ts';

export type VoicePreviewResult = {state:'ready';audio:Uint8Array}|{state:'empty'|'pending'|'unavailable'};
async function voiceForPreview(accountId:string) {
 if(await db<boolean>('rpc/icash_vip_features_active','POST',{p_account:accountId})!==true)throw Error('VIP_REQUIRED');
 const [voice]=await db<CustomVoice[]>(`icash_custom_voices?account_id=eq.${accountId}&select=*`);
 if(!voice||voice.state!=='ready'||!voice.voice_id)throw Error('VOICE_NOT_READY');
 return voice;
}
async function loadPreview(voice:CustomVoice) {
 const [row]=await db<CustomVoicePreview[]>(`icash_custom_voice_previews?account_id=eq.${voice.account_id}&custom_voice_id=eq.${voice.id}&voice_id=eq.${voice.voice_id}&order=attempt.desc&limit=1`);
 return row??null;
}
function result(row:CustomVoicePreview|null):VoicePreviewResult {
 if(!row)return {state:'empty'};
 if(row.state==='ready'&&row.audio_base64){const audio=new Uint8Array(Buffer.from(row.audio_base64,'base64'));if(previewAudioValid(audio))return {state:'ready',audio};}
 if(row.state==='generating'&&Date.parse(row.created_at)>Date.now()-120_000)return {state:'pending'};
 return {state:'unavailable'};
}
async function save(row:CustomVoicePreview,changes:Record<string,unknown>) {
 const [saved]=await db<CustomVoicePreview[]>(`icash_custom_voice_previews?id=eq.${row.id}&account_id=eq.${row.account_id}&state=in.(generating,unknown)`,'PATCH',{...changes,updated_at:new Date().toISOString()});
 if(!saved)throw Error('PREVIEW_SAVE_UNCONFIRMED');return saved;
}
const providerId=(value:string|null)=>value&&/^[A-Za-z0-9_-]{1,200}$/.test(value)?value:null;
async function audioBytes(response:Response) {
 if(!response.ok||!/^audio\/mpeg(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)throw Error('PREVIEW_AUDIO_UNCONFIRMED');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxCustomVoicePreviewBytes){await reader.cancel();throw Error('PREVIEW_AUDIO_TOO_LARGE');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 if(!previewAudioValid(bytes))throw Error('PREVIEW_AUDIO_UNCONFIRMED');return bytes;
}
async function retainAudio(row:CustomVoicePreview,response:Response) {
 const audio=await audioBytes(response);
 await save(row,{state:'ready',audio_base64:Buffer.from(audio).toString('base64')});
 return {state:'ready' as const,audio};
}
/** Read-only playback never calls ElevenLabs or customer usage admission. */
export async function readCustomVoicePreview(accountId:string):Promise<VoicePreviewResult> {
 return result(await loadPreview(await voiceForPreview(accountId)));
}
/** Called only by an authenticated Play click, never during setup or a build. */
export async function prepareCustomVoicePreview(accountId:string,userId:string,fetcher:typeof fetch=fetch):Promise<VoicePreviewResult> {
 if(typeof window!=='undefined')throw Error('VOICE_SERVER_ONLY');
 const voice=await voiceForPreview(accountId),existing=await loadPreview(voice);
 const cached=result(existing);if(cached.state==='ready')return cached;
 const key=process.env.ELEVENLABS_API_KEY;if(!key)throw Error('VOICE_KEY_MISSING');
 // Confirm the clone belongs to this account and is verified before consuming
 // a one-use claim. Listening does not enable it for live calls.
 const canonical=await elevenRequest<ProviderCustomVoice>('/v1/voices/'+encodeURIComponent(voice.voice_id!),undefined,fetcher);
 if(!providerVoiceMatches(canonical,voice)||canonical.voice_verification?.requires_verification===true&&canonical.voice_verification.is_verified!==true)throw Error('VOICE_NOT_READY');
 const claim=await db<{started:boolean;preview:CustomVoicePreview}>('rpc/icash_begin_custom_voice_preview','POST',{
  p_user:userId,p_account:accountId,p_voice:voice.id,p_provider_voice:voice.voice_id,p_request:customVoicePreviewRequest,
 });
 const row=claim.preview;
 if(!claim.started){
  const current=result(row);if(current.state==='ready')return current;
  // Recover only the exact saved provider artifact. This GET cannot synthesize
  // audio, including after a disconnected browser or failed cache write.
  if(row.history_item_id){
   try{
    const response=await fetcher(`https://api.elevenlabs.io/v1/history/${encodeURIComponent(row.history_item_id)}/audio`,{headers:{'xi-api-key':key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
    return await retainAudio(row,response);
   }catch{return current;}
  }
  return current;
 }
 let response:Response;
 try{
  // No provider retry: a timeout might still have produced billable speech.
  response=await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(row.voice_id)}?output_format=mp3_44100_128`,{
   method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(row.request),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000),
  });
 }catch{await save(row,{state:'unknown'}).catch(()=>{});return {state:'unavailable'};}
 try{
  const history=providerId(response.headers.get('history-item-id')),requestId=providerId(response.headers.get('request-id'));
  const cost=response.headers.get('character-cost');
  // Persist original response identity before consuming the audio stream.
  const saved=await save(row,{provider_status:response.status,history_item_id:history,request_id:requestId,
   character_cost:cost&&/^\d{1,9}$/.test(cost)?Number(cost):null,
   ...(!response.ok?{state:!response.headers.has('history-item-id')&&[400,401,403,404,413,422,429].includes(response.status)?'rejected':'unknown'}:{}),
  });
  if(!response.ok){await response.body?.cancel();return {state:'unavailable'};}
  return await retainAudio(saved,response);
 }catch{
  await response.body?.cancel().catch(()=>{});
  await save(row,{state:'unknown'}).catch(()=>{});
  return {state:'unavailable'};
 }
}
