import {createHash} from 'node:crypto';
import {db} from './stripe-test.ts';
import {elevenRequest} from './elevenlabs.ts';
import {type CustomVoice,type ProviderCustomVoice,providerVoiceName,providerVoiceMatches,providerVoiceReady,sampleFormat,ownVoiceConsentVersion,publicCustomVoice} from './custom-voice-policy.ts';

const path=(accountId:string)=>`icash_custom_voices?account_id=eq.${accountId}`;
async function load(accountId:string){return (await db<CustomVoice[]>(path(accountId)+'&select=*'))[0]??null;}
async function save(row:CustomVoice,changes:Partial<CustomVoice>){
 const [saved]=await db<CustomVoice[]>(path(row.account_id)+`&id=eq.${row.id}`,'PATCH',{...changes,updated_at:new Date().toISOString()});
 if(!saved)throw Error('Voice setup changed. Refresh and try again.');return saved;
}
async function reconcile(row:CustomVoice){
 if(!['creating','unknown','verification_required'].includes(row.state))return row;
 if(row.state==='creating'&&Date.parse(row.created_at)>Date.now()-120000)return row;
 try{
  let voice:ProviderCustomVoice|undefined;
  if(row.voice_id)voice=await elevenRequest<ProviderCustomVoice>('/v1/voices/'+encodeURIComponent(row.voice_id));
  else {const catalog=await elevenRequest<{voices:ProviderCustomVoice[]}>('/v1/voices');const matches=catalog.voices.filter(v=>providerVoiceMatches(v,row));if(matches.length===1)voice=matches[0];}
  if(voice&&providerVoiceMatches(voice,row))return save(row,{voice_id:voice.voice_id,state:providerVoiceReady(voice)?'ready':'verification_required'});
 }catch{/* An uncertain provider write must not be submitted twice. */}
 return row;
}
export async function customVoiceStatus(accountId:string){
 const vip=await db<boolean>('rpc/icash_vip_active','POST',{p_account:accountId});
 const row=await load(accountId);return publicCustomVoice(row?await reconcile(row):null,vip);
}
export async function createCustomVoice(accountId:string,userId:string,bytes:Uint8Array,consent:string,fetcher:typeof fetch=fetch){
 if(consent!==ownVoiceConsentVersion)throw Error('Confirm that this recording is your own voice.');
 const format=sampleFormat(bytes),key=process.env.ELEVENLABS_API_KEY;if(!key)throw Error('Voice setup is temporarily unavailable.');
 const start=await db<{started:boolean;voice:CustomVoice}>('rpc/icash_begin_custom_voice','POST',{p_user:userId,p_account:accountId,p_hash:createHash('sha256').update(bytes).digest('hex'),p_consent:consent});
 if(!start.started)return customVoiceStatus(accountId);
 const row=start.voice,form=new FormData();form.set('name',providerVoiceName(row.id));form.set('description','Private voice for the uploading iCash X account.');form.set('files',new Blob([new Uint8Array(bytes)],{type:format.type}),'voice-sample.'+format.extension);
 let response:Response;
 try{response=await fetcher('https://api.elevenlabs.io/v1/voices/add',{method:'POST',headers:{'xi-api-key':key},body:form,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});}
 catch{await save(row,{state:'unknown'});return customVoiceStatus(accountId);}
 if(!response.ok){
  // Explicit request rejection can be retried; a server failure may have created a voice.
  await save(row,{state:[400,401,403,413,422,429].includes(response.status)?'failed':'unknown'});
  throw Error(response.status===401||response.status===403?'Custom voice setup needs a provider connection update. Your standard voice is still active.':'The voice could not be confirmed. Refresh its status before retrying.');
 }
 let result:{voice_id?:string;requires_verification?:boolean};
 try{result=await response.json();if(!result.voice_id||!/^[A-Za-z0-9_-]{5,100}$/.test(result.voice_id))throw Error();}
 catch{await save(row,{state:'unknown'});return customVoiceStatus(accountId);}
 // Save the provider ID before a second network request, so retries can recover safely.
 const saved=await save(row,{voice_id:result.voice_id,state:'verification_required'});
 const canonical=await elevenRequest<ProviderCustomVoice>('/v1/voices/'+encodeURIComponent(result.voice_id)).catch(()=>null);
 if(canonical&&providerVoiceMatches(canonical,saved)&&(providerVoiceReady(canonical)||result.requires_verification===false&&canonical.voice_verification?.requires_verification!==true))await save(saved,{state:'ready'});
 return customVoiceStatus(accountId);
}
/** The account's normal identity stays unchanged; expired VIP falls back automatically. */
export async function selectedCustomCallVoice(accountId:string){
 const id=await db<string|null>('rpc/icash_vip_call_voice','POST',{p_account:accountId});if(!id)return null;
 const row=await load(accountId);if(!row||row.voice_id!==id)return null;
 try{const canonical=await elevenRequest<ProviderCustomVoice>('/v1/voices/'+encodeURIComponent(id));
  if(!providerVoiceMatches(canonical,row)||canonical.voice_verification?.requires_verification===true&&canonical.voice_verification.is_verified!==true)return null;
  // Recheck after provider I/O so switching to the standard voice wins a race.
  return await db<string|null>('rpc/icash_vip_call_voice','POST',{p_account:accountId})===id?id:null;
 }catch{return null;}
}
