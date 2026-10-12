'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ownVoiceConsentVersion,maxVoiceSampleBytes} from '@/lib/custom-voice-policy';
import styles from './vip-custom-voice.module.css';
type VoiceState={state:string;enabled:boolean;vip:boolean};
export function VipCustomVoice(){
 const fileInput=useRef<HTMLInputElement>(null),consentInput=useRef<HTMLInputElement>(null),inputId=useId(),hintId=useId();
 const [voice,setVoice]=useState<VoiceState|null>(null),[file,setFile]=useState<File|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sampleUrl,setSampleUrl]=useState('');const lock=useRef(false);
 async function refresh(){const r=await fetch('/api/account/custom-voice',{cache:'no-store',signal:AbortSignal.timeout(30000)}),data=await r.json();if(!r.ok)throw Error(data.error);setVoice(data);}
 useEffect(()=>{let live=true;void fetch('/api/account/custom-voice',{cache:'no-store',signal:AbortSignal.timeout(30000)}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(live)setVoice(data);}).catch(()=>{if(live)setError('Could not load your voice. Tap Refresh.');});return ()=>{live=false;};},[]);
 useEffect(()=>{if(!file){setSampleUrl('');return;}const url=URL.createObjectURL(file);setSampleUrl(url);return ()=>URL.revokeObjectURL(url);},[file]);
 async function act(action:'upload'|'toggle'|'refresh'){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   if(action==='refresh'){await refresh();return;}
   let body:FormData|string,method:string;
   if(action==='upload'){if(!file)throw Error('Choose a recording first.');if(!consent){consentInput.current?.focus();throw Error('Check the box confirming this is your voice, then select Create my voice.');}const form=new FormData();form.set('sample',file);form.set('consent',ownVoiceConsentVersion);body=form;method='POST';}
   else {body=JSON.stringify({enabled:!voice?.enabled});method='PATCH';}
   const r=await fetch('/api/account/custom-voice',{method,body,...(method==='PATCH'?{headers:{'Content-Type':'application/json'}}:{}),signal:AbortSignal.timeout(100000)}),data=await r.json();if(!r.ok)throw Error(data.error);setVoice(data);if(action==='upload'){setFile(null);setConsent(false);}
  }catch(e){setError(e instanceof Error?e.message:'Could not confirm. Refresh before trying again.');}finally{lock.current=false;setBusy(false);}
 }
 const uploading=voice&&['creating','unknown'].includes(voice.state),canUpload=voice?.vip&&['empty','failed'].includes(voice.state);
 return <section className={`vip-custom-voice ${styles.voice}`} aria-label="Custom AI voice"><div className={styles.heading}><strong>Custom voice</strong><span>{voice?.enabled?'Active':voice?.state==='ready'?'Standard voice active':'Included with VIP'}</span></div><p>Upload a clear recording of yourself. Your bot uses your voice when calling sellers.</p>
 {!voice&&!error&&<p role="status">Loading voice settings…</p>}
 {voice&&!voice.vip&&<p role="status">Switch your account to VIP to use your custom voice.</p>}
 {canUpload&&<form className={styles.form} onSubmit={e=>{e.preventDefault();void act('upload');}}>
  <input ref={fileInput} id={inputId} className={styles.fileInput} type="file" tabIndex={-1} aria-label="Voice recording" aria-describedby={hintId} accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm,.mp3,.m4a,.wav,.webm" disabled={busy} onChange={e=>{const selected=e.target.files?.[0]??null;if(!selected)return;setError('');setConsent(false);if(selected.size>maxVoiceSampleBytes){setError('This file is over 4 MB. Choose a smaller recording, such as an MP3 or M4A.');setFile(null);e.target.value='';return;}setFile(selected);}}/>
  <button type="button" className={styles.choose} disabled={busy} onClick={()=>fileInput.current?.click()}>{file?'Change recording':'Choose recording'}</button>
  <small id={hintId}>1–2 minutes of clear speech. MP3, M4A, WAV, or WebM, under 4 MB.</small>
  {file&&<><p className={styles.filename}>{file.name}</p>{sampleUrl&&<audio controls src={sampleUrl} aria-label="Your uploaded recording"/>}
   <label className={styles.consent}><input ref={consentInput} type="checkbox" checked={consent} disabled={busy} onChange={e=>{setConsent(e.target.checked);setError('');}}/><span>This is my voice. I authorize its use for my AI bot.</span></label>
   <button type="submit" className={`fund-button ${styles.create}`} disabled={busy}>{busy?'Creating your voice…':'Create my voice'}</button>
  </>}
 </form>}
 {voice?.state==='ready'&&<button type="button" className="membership-payment-link" disabled={busy} onClick={()=>void act('toggle')}>{busy?'Saving…':voice.enabled?'Use standard voice':'Use my voice'}</button>}
 {uploading&&<p role="status">Your voice setup is being confirmed. Your standard voice stays available in the meantime.</p>}
 {voice?.state==='verification_required'&&<p role="status">The voice provider needs additional verification. Contact Help to finish setup. Your standard voice stays active.</p>}
 {(uploading||voice?.state==='verification_required'||error||!voice)&&<button type="button" className="membership-payment-link" disabled={busy} onClick={()=>void act('refresh')}>Refresh</button>}
 {error&&<p className={styles.error} role="alert">{error}</p>}
 </section>;
}
