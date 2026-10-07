'use client';
import {useEffect,useRef,useState} from 'react';
import {ownVoiceConsentVersion,maxVoiceSampleBytes} from '@/lib/custom-voice-policy';
type VoiceState={state:string;enabled:boolean;vip:boolean};
export function VipCustomVoice(){
 const [voice,setVoice]=useState<VoiceState|null>(null),[file,setFile]=useState<File|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sampleUrl,setSampleUrl]=useState('');const lock=useRef(false);
 async function refresh(){const r=await fetch('/api/account/custom-voice',{cache:'no-store',signal:AbortSignal.timeout(30000)}),data=await r.json();if(!r.ok)throw Error(data.error);setVoice(data);}
 useEffect(()=>{let live=true;void fetch('/api/account/custom-voice',{cache:'no-store',signal:AbortSignal.timeout(30000)}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(live)setVoice(data);}).catch(()=>{if(live)setError('Could not load your voice. Tap Refresh.');});return ()=>{live=false;};},[]);
 useEffect(()=>{if(!file){setSampleUrl('');return;}const url=URL.createObjectURL(file);setSampleUrl(url);return ()=>URL.revokeObjectURL(url);},[file]);
 async function act(action:'upload'|'toggle'|'refresh'){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   if(action==='refresh'){await refresh();return;}
   let body:FormData|string,method:string;
   if(action==='upload'){if(!file||!consent)throw Error('Choose your recording and confirm it is your own voice.');const form=new FormData();form.set('sample',file);form.set('consent',ownVoiceConsentVersion);body=form;method='POST';}
   else {body=JSON.stringify({enabled:!voice?.enabled});method='PATCH';}
   const r=await fetch('/api/account/custom-voice',{method,body,...(method==='PATCH'?{headers:{'Content-Type':'application/json'}}:{}),signal:AbortSignal.timeout(100000)}),data=await r.json();if(!r.ok)throw Error(data.error);setVoice(data);if(action==='upload'){setFile(null);setConsent(false);}
  }catch(e){setError(e instanceof Error?e.message:'Could not confirm. Refresh before trying again.');}finally{lock.current=false;setBusy(false);}
 }
 const uploading=voice&&['creating','unknown'].includes(voice.state),canUpload=voice&&['empty','failed'].includes(voice.state);
 return <section className="vip-custom-voice" aria-label="Custom AI voice"><div className="vip-voice-heading"><strong>Your voice</strong><span>{voice?.enabled?'Active':voice?.state==='ready'?'Standard voice active':'Included with VIP'}</span></div><p>Upload one clear recording of yourself. Your bot uses your voice on outbound seller and buyer calls.</p>
 {canUpload&&<form onSubmit={e=>{e.preventDefault();void act('upload');}}><label htmlFor="vip-voice-file">Voice recording</label><input id="vip-voice-file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm,.mp3,.m4a,.wav,.webm" disabled={busy} onChange={e=>{const selected=e.target.files?.[0]??null;setError('');setConsent(false);if(selected&&selected.size>maxVoiceSampleBytes){setError('Choose a recording under 4 MB.');setFile(null);e.target.value='';return;}setFile(selected);}}/><small>Use 1–2 minutes of natural speech in a quiet room. MP3, M4A, WAV, or WebM, up to 4 MB.</small>{sampleUrl&&<audio controls src={sampleUrl} aria-label="Your uploaded recording"/>}<label className="vip-voice-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>This is my voice. I authorize its use for my AI bot.</span></label><button type="submit" className="fund-button" disabled={busy||!file||!consent}>{busy?'Creating your voice…':'Create my voice'}</button></form>}
 {voice?.state==='ready'&&<button type="button" className="membership-payment-link" disabled={busy} onClick={()=>void act('toggle')}>{busy?'Saving…':voice.enabled?'Use standard voice':'Use my voice'}</button>}
 {uploading&&<p role="status">Your voice setup is being confirmed. Your standard voice stays available in the meantime.</p>}
 {voice?.state==='verification_required'&&<p role="status">The voice provider needs additional verification. Contact Help to finish setup. Your standard voice stays active.</p>}
 {(uploading||voice?.state==='verification_required'||error||!voice)&&<button type="button" className="membership-payment-link" disabled={busy} onClick={()=>void act('refresh')}>Refresh</button>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
