'use client';
import {useEffect,useState} from 'react';
import {measurementPolicyVersion} from '@/lib/webinar-measurement-policy';
type Preference={enabled:boolean;trackingAllowed:boolean};
const gpc=()=>!!(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl;
export function WebinarAdPrivacy(){
 const [preference,setPreference]=useState<Preference|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(false);
 useEffect(()=>{
  let alive=true;setBlocked(gpc());
  let denied=false;try{denied=localStorage.getItem('wb-meta-choice')==='deny';}catch{/* Optional storage. */}
  const init:RequestInit=denied?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow:false,version:measurementPolicyVersion})}:{cache:'no-store'};
  void fetch('/api/webinar/measurement',init).then(async response=>{if(!response.ok)throw Error();return response.json();}).then(value=>{if(alive)setPreference(value);}).catch(()=>{if(alive)setMessage('You can save an opt-out for this browser below.');});
  return()=>{alive=false;};
 },[]);
 async function choose(allow:boolean){
  if(busy||allow&&gpc())return;setBusy(true);setMessage('');
  if(!allow){try{localStorage.setItem('wb-meta-choice','deny');}catch{/* Still save the server preference. */}}
  try{
   const response=await fetch('/api/webinar/measurement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow,version:measurementPolicyVersion})});
   if(!response.ok){if(!allow&&response.status===401){setPreference({enabled:false,trackingAllowed:false});setMessage('Ad measurement is off for this browser.');return;}throw Error('Could not save your preference. Please try again.');}
   const value=await response.json() as Preference;setPreference(value);
   try{localStorage.setItem('wb-meta-choice',value.trackingAllowed?'allow':'deny');}catch{/* Server choice is saved. */}
   if(!value.trackingAllowed)for(const key of ['_fbp','_fbc'])document.cookie=`${key}=; Max-Age=0; Path=/; SameSite=Lax`;
   setMessage(value.trackingAllowed?'Ad measurement is on.':'Ad measurement is off. Your webinar access stays the same.');
  }catch(e){setMessage(e instanceof Error?e.message:'Could not save your preference.');}finally{setBusy(false);}
 }
 return <section aria-label="Ad privacy settings"><h2>Ad privacy settings</h2><p>{blocked?'Your browser’s Global Privacy Control keeps ad measurement off.':preference?`Ad measurement is ${preference.trackingAllowed?'on':'off'} for this browser.`:'Checking your preference…'}</p><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button type="button" className="wb-primary" disabled={busy} onClick={()=>void choose(false)}>Turn off ad measurement</button><button type="button" className="wb-text" disabled={busy||blocked||!preference?.enabled} onClick={()=>void choose(true)}>Allow ad measurement</button></div>{message&&<p role="status">{message}</p>}</section>;
}
