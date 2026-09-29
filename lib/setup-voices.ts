import {unstable_cache} from 'next/cache';
import type {SetupVoice} from './bot-setup';
/** Provider-supplied previews only. No paid TTS synthesis per visitor. */
export const setupVoices=unstable_cache(async():Promise<SetupVoice[]>=>{
 const key=process.env.ELEVENLABS_API_KEY;if(!key)return [];
 const r=await fetch('https://api.elevenlabs.io/v2/voices?page_size=100',{headers:{'xi-api-key':key},signal:AbortSignal.timeout(10000),redirect:'error',cache:'no-store'});
 if(!r.ok)throw Error('Voice catalog unavailable');
 const catalog=await r.json() as {voices:{voice_id:string;name:string;category:string;preview_url?:string}[]};
 return ([['sarah','Warm & conversational'],['chris','Relaxed & direct'],['jessica','Clear & friendly']] as const).flatMap(([key,description])=>{
  const v=catalog.voices.find(v=>v.category==='premade'&&new RegExp(`^${key}(\\s|$)`,'i').test(v.name));
  if(!v?.preview_url||!/^[A-Za-z0-9_-]{5,100}$/.test(v.voice_id))return [];
  let u:URL;try{u=new URL(v.preview_url);}catch{return [];}
  if(u.protocol!=='https:'||!['storage.googleapis.com','api.elevenlabs.io'].includes(u.hostname))return [];
  return [{key,name:key[0].toUpperCase()+key.slice(1),description,previewUrl:u.href,voiceId:v.voice_id}];
 });
},['icash-setup-voices-v1'],{revalidate:86400});
