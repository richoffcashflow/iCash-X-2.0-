'use client';
import {useEffect,useRef,useState} from 'react';
const consentVersion='webinar-meta-2026-10-04';
type Pixel=((...args:unknown[])=>void)&{queue:unknown[][];callMethod?:(...args:unknown[])=>void;loaded:boolean;version:string;push?:Pixel};
type PixelWindow=Window&{fbq?:Pixel;_fbq?:Pixel};
type MetaEvent={eventName:string;eventId:string;data:Record<string,unknown>};
type Measurement={enabled:boolean;pixelId?:string;consent?:boolean;events?:MetaEvent[]};
function pixel(id:string){
 const w=window as PixelWindow;
 if(!w.fbq){const f=((...args:unknown[])=>{if(f.callMethod)f.callMethod(...args);else f.queue.push(args);}) as Pixel;f.queue=[];f.loaded=true;f.version='2.0';f.push=f;w.fbq=f;w._fbq=f;
  const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';document.head.appendChild(script);
 }
 w.fbq('set','autoConfig',false,id);w.fbq('init',id);return w.fbq;
}
const storage={get(key:string){try{return localStorage.getItem(key);}catch{return null;}},set(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Optional measurement. */}}};
export function WebinarMeasurement(){
 const [config,setConfig]=useState<Measurement|null>(null),[choice,setChoice]=useState<string|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef<Measurement|null>(null),session=useRef(''),initialized=useRef(''),sent=useRef(new Set<string>()),refreshVersion=useRef(0);
 const gpc=()=>!!(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl;
 function emit(event:MetaEvent){
  const c=current.current;if(!c?.enabled||!c.consent||!c.pixelId||gpc()||sent.current.has(event.eventId)||storage.get('wb-meta:'+event.eventId))return;
  if(initialized.current!==c.pixelId){pixel(c.pixelId);initialized.current=c.pixelId;}
  const f=(window as PixelWindow).fbq;if(!f)return;f('consent','grant');
  f(event.eventName==='WebinarOfferOpened'?'trackSingleCustom':'trackSingle',c.pixelId,event.eventName,event.data,{eventID:event.eventId});sent.current.add(event.eventId);storage.set('wb-meta:'+event.eventId,'1');
 }
 async function refresh(){
  if(!session.current)return;
  const version=++refreshVersion.current;
  try{const res=await fetch('/api/webinar/measurement',{cache:'no-store'});if(!res.ok)return;const next=await res.json() as Measurement;if(version!==refreshVersion.current)return;current.current=next;setConfig(next);
   if(next.consent){setChoice('allow');storage.set('wb-meta-choice','allow');emit({eventName:'ViewContent',eventId:`webinar:${session.current}:view`,data:{content_type:'product',content_ids:['icash-webinar']}});}
   for(const event of next.events??[])emit(event);
  }catch{/* Playback is independent of measurement. */}
 }
 useEffect(()=>{
  if(['/webinar-studio','/webinaradmin'].includes(location.pathname)||new URLSearchParams(location.search).has('preview'))return;
  setChoice(storage.get('wb-meta-choice'));
  try{session.current=sessionStorage.getItem('icash-webinar-session')||'';}catch{/* Optional measurement. */}
  const ready=(event:Event)=>{session.current=(event as CustomEvent<{sessionId:string}>).detail.sessionId;void refresh();};
  const track=(event:Event)=>{const d=(event as CustomEvent<{sessionId:string;kind:string}>).detail;const names:Record<string,string>={started:'ViewContent',contact_saved:'Lead',add_to_cart:'AddToCart',checkout_opened:'WebinarOfferOpened',checkout_started:'InitiateCheckout'};if(names[d.kind])emit({eventName:names[d.kind],eventId:`webinar:${d.sessionId}:${d.kind==='started'?'view':d.kind}`,data:{content_ids:['icash-webinar']}});};
  window.addEventListener('icash-webinar-ready',ready);window.addEventListener('icash-webinar-track',track);void refresh();
  const returned=new URLSearchParams(location.search).has('session_id');let tries=0;
  const timer=returned?setInterval(()=>{if(!document.hidden&&++tries<=12)void refresh();},5000):undefined;
  return()=>{window.removeEventListener('icash-webinar-ready',ready);window.removeEventListener('icash-webinar-track',track);clearInterval(timer);};
 // The listeners read current configuration through refs, including consent changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function choose(allow:boolean){
  if(busy)return;setBusy(true);setError('');
  refreshVersion.current++;
  if(!allow||gpc()){if(current.current)current.current={...current.current,consent:false};(window as PixelWindow).fbq?.('consent','revoke');}
  try{
   const readCookie=(key:string)=>document.cookie.split('; ').find(c=>c.startsWith(key+'='))?.slice(key.length+1);
   const res=await fetch('/api/webinar/measurement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow:allow&&!gpc(),version:consentVersion,...(allow?{fbp:readCookie('_fbp'),fbc:readCookie('_fbc'),fbclid:new URLSearchParams(location.search).get('fbclid')||undefined}:{})})});
   if(!res.ok)throw Error('Could not save your preference. Please retry.');const result=await res.json();
   const value=result.consent?'allow':'deny';setChoice(value);storage.set('wb-meta-choice',value);setEditing(false);
   if(!result.consent){if(current.current)current.current={...current.current,consent:false};(window as PixelWindow).fbq?.('consent','revoke');for(const key of ['_fbp','_fbc'])document.cookie=`${key}=; Max-Age=0; Path=/; SameSite=Lax`;}
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{setBusy(false);}
 }
 if(!config?.enabled)return null;
 const show=editing||(!choice&&!config.consent);
 return <div className="webinar-measurement" style={{position:'fixed',left:12,bottom:84,zIndex:60,maxWidth:360,fontFamily:'Arial,sans-serif',fontSize:13,color:'#193b29'}}>
  {show?<section aria-label="Ad measurement preference" style={{padding:18,borderRadius:16,background:'#fff',boxShadow:'0 8px 32px #0003',border:'1px solid #dce3d8'}}><strong>Help us improve our ads?</strong><p style={{lineHeight:1.5,margin:'8px 0'}}>Allow Meta to measure your visits and purchases. This is optional and separate from email updates.</p><div style={{display:'flex',gap:10}}><button disabled={busy} onClick={()=>void choose(false)}>No thanks</button><button disabled={busy||gpc()} onClick={()=>void choose(true)}>Allow measurement</button></div><a href="/webinar/privacy">Privacy details</a>{error&&<p role="alert">{error}</p>}</section>:<button onClick={()=>setEditing(true)} style={{borderRadius:12,padding:'6px 9px',background:'#fff',border:'1px solid #dce3d8',fontSize:11}}>Ad privacy</button>}
 </div>;
}
