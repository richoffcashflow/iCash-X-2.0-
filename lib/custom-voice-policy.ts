export const ownVoiceConsentVersion='own-voice-2026-10-07.1';
export const maxVoiceSampleBytes=4_000_000;
export type CustomVoice={id:string;account_id:string;state:'creating'|'ready'|'verification_required'|'unknown'|'failed';voice_id:string|null;enabled:boolean;created_at:string;updated_at:string};
export type ProviderCustomVoice={voice_id:string;name?:string;category?:string;is_owner?:boolean;voice_verification?:{requires_verification?:boolean;is_verified?:boolean}};
export const providerVoiceName=(id:string)=>`icash-vip-${id}`;
export function providerVoiceMatches(v:ProviderCustomVoice,row:CustomVoice){return /^[A-Za-z0-9_-]{5,100}$/.test(v.voice_id)&&v.name===providerVoiceName(row.id)&&v.category==='cloned'&&v.is_owner!==false&&(!row.voice_id||v.voice_id===row.voice_id);}
export function providerVoiceReady(v:ProviderCustomVoice){return v.voice_verification?.requires_verification===false||v.voice_verification?.is_verified===true;}
export function sampleFormat(bytes:Uint8Array){
 if(bytes.length<1000||bytes.length>maxVoiceSampleBytes)throw Error('Use an audio recording under 4 MB.');
 const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
 if(ascii(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&0xe0)===0xe0)return {type:'audio/mpeg',extension:'mp3'};
 if(ascii(4,8)==='ftyp')return {type:'audio/mp4',extension:'m4a'};
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE')return {type:'audio/wav',extension:'wav'};
 if(bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return {type:'audio/webm',extension:'webm'};
 throw Error('Upload an MP3, M4A, WAV, or WebM audio recording.');
}
export function publicCustomVoice(row:CustomVoice|null,vip:boolean){return {state:row?.state??'empty',enabled:!!row?.enabled&&row.state==='ready'&&vip,vip};}
