'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {dashboardPath} from '@/lib/dashboard-paths';
import type {WebinarCommerce} from '@/lib/webinar-browser-events';
import {measurementPolicyVersion} from '@/lib/webinar-measurement-policy';
type Pixel=((...args:unknown[])=>void)&{queue:unknown[][];callMethod?:(...args:unknown[])=>void;loaded:boolean;version:string;push?:Pixel};
type PixelWindow=Window&{fbq?:Pixel;_fbq?:Pixel};
type MetaEvent={eventName:string;eventId:string;data:Record<string,unknown>};
type Measurement={enabled:boolean;pixelId?:string;trackingAllowed?:boolean;consent?:boolean;events?:MetaEvent[]};
const webinarPage=(path:string)=>path==='/webinar'||/^\/live\/\d{6,12}\/?$/.test(path)||path==='/webinar/checkout'||path==='/webinar/upgrade';
const measurementPage=()=>webinarPage(location.pathname)&&!new URLSearchParams(location.search).has('preview');
function pixel(id:string){
 const w=window as PixelWindow;
 if(!w.fbq){const f=((...args:unknown[])=>{if(f.callMethod)f.callMethod(...args);else f.queue.push(args);}) as Pixel;f.queue=[];f.loaded=true;f.version='2.0';f.push=f;w.fbq=f;w._fbq=f;
  const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';document.head.appendChild(script);
 }
 w.fbq('set','autoConfig',false,id);w.fbq('init',id);return w.fbq;
}
const storage={get(key:string){try{return localStorage.getItem(key);}catch{return null;}},set(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Optional measurement. */}}};
export function WebinarMeasurement(){
 const pathname=usePathname(),privatePage=dashboardPath(pathname)||pathname==='/dashboard-unlock'||!webinarPage(pathname);
 const [config,setConfig]=useState<Measurement|null>(null);
 const current=useRef<Measurement|null>(null),session=useRef(''),initialized=useRef(''),sent=useRef(new Set<string>()),refreshVersion=useRef(0),pageView=useRef({path:'',id:''});
 const pendingStages=useRef<MetaEvent[]>([]);
 const gpc=()=>!!(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl;
 function emit(event:MetaEvent){
  if(!measurementPage())return;
  const c=current.current;if(!c?.enabled||!c.trackingAllowed||!c.pixelId||gpc()||sent.current.has(event.eventId)||storage.get('wb-meta:'+event.eventId))return;
  if(initialized.current!==c.pixelId){pixel(c.pixelId);initialized.current=c.pixelId;}
  const f=(window as PixelWindow).fbq;if(!f)return;f('consent','grant');
  f(event.eventName==='WebinarOfferOpened'?'trackSingleCustom':'trackSingle',c.pixelId,event.eventName,event.data,{eventID:event.eventId});sent.current.add(event.eventId);storage.set('wb-meta:'+event.eventId,'1');
 }
 async function refresh(timeoutMs=8000){
  if(!measurementPage())return;
  if(!session.current)return;
  const version=++refreshVersion.current;
  const optedOut=storage.get('wb-meta-choice')==='deny'||gpc();
  if(optedOut){if(current.current)current.current={...current.current,trackingAllowed:false};(window as PixelWindow).fbq?.('consent','revoke');pendingStages.current=[];}
  const cookie=(key:string)=>document.cookie.split('; ').find(c=>c.startsWith(key+'='))?.slice(key.length+1);
  const identifiers=current.current?.trackingAllowed?{fbp:cookie('_fbp'),fbc:cookie('_fbc')}:{};
  try{const res=await fetch('/api/webinar/measurement',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({action:'automatic',version:measurementPolicyVersion,optedOut,...identifiers,fbclid:new URLSearchParams(location.search).get('fbclid')||undefined})});if(!res.ok)return;const next=await res.json() as Measurement;if(version!==refreshVersion.current)return;current.current=next;setConfig(next);
   if(next.trackingAllowed){emit({eventName:'PageView',eventId:pageView.current.id,data:{}});emit({eventName:'ViewContent',eventId:`webinar:${session.current}:view`,data:{content_type:'product',content_ids:['icash-webinar']}});}
   for(const event of next.events??[])emit(event);
   for(const event of pendingStages.current.splice(0))emit(event);
  }catch{/* Playback is independent of measurement. */}
 }
 useEffect(()=>{
  refreshVersion.current++;current.current=null;pendingStages.current=[];setConfig(null);
  if(pageView.current.path!==pathname)pageView.current={path:pathname,id:privatePage?'':`webinar:page:${crypto.randomUUID()}`};
  if(privatePage||!measurementPage())return;
  try{session.current=sessionStorage.getItem('icash-webinar-session')||'';}catch{/* Optional measurement. */}
  const ready=(event:Event)=>{session.current=(event as CustomEvent<{sessionId:string}>).detail.sessionId;void refresh();};
  const track=(event:Event)=>{
   const d=(event as CustomEvent<{sessionId:string;kind:string;commerce?:WebinarCommerce}>).detail;
   const names:Record<string,string>={started:'ViewContent',contact_saved:'Lead',add_to_cart:'AddToCart',checkout_opened:'WebinarOfferOpened',checkout_started:'InitiateCheckout'};
   if(!names[d.kind])return;
   const c=d.commerce,scope=c?`${d.kind==='checkout_started'&&c.checkoutId?'checkout:'+c.checkoutId:d.sessionId}:${c.product}`:d.sessionId;
   const stage={eventName:names[d.kind],eventId:`webinar:${scope}:${d.kind==='started'?'view':d.kind}`,data:{content_type:'product',content_ids:[c?'icash-'+c.product:'icash-webinar'],...(c?{content_category:c.product,num_items:1}:{}),...(c?.valueCents!==undefined&&Number.isSafeInteger(c.valueCents)&&c.valueCents>0?{value:c.valueCents/100,currency:'USD'}:{})}};
   // Hold early stages only until server geography and privacy checks finish.
   // A disabled response discards these; later permission cannot replay them.
   if(!current.current&&storage.get('wb-meta-choice')!=='deny'&&!gpc()){pendingStages.current.push(stage);if(pendingStages.current.length>20)pendingStages.current.shift();return;}
   emit(stage);
  };
  const paid=(event:Event)=>{if(!gpc())(event as CustomEvent<{waitUntil:(promise:Promise<void>)=>void}>).detail.waitUntil(refresh(1800));};
  const privacy=(event:StorageEvent)=>{if(event.key==='wb-meta-choice')void refresh();};
  window.addEventListener('storage',privacy);
  window.addEventListener('icash-webinar-ready',ready);window.addEventListener('icash-webinar-track',track);window.addEventListener('icash-webinar-payment-confirmed',paid);void refresh();
  const returned=new URLSearchParams(location.search).has('session_id');let tries=0;
  const timer=returned?setInterval(()=>{if(!document.hidden&&++tries<=12)void refresh();},5000):undefined;
  return()=>{refreshVersion.current++;window.removeEventListener('storage',privacy);window.removeEventListener('icash-webinar-ready',ready);window.removeEventListener('icash-webinar-track',track);window.removeEventListener('icash-webinar-payment-confirmed',paid);clearInterval(timer);};
 // The listeners read current configuration through refs, including consent changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[privatePage,pathname]);
 if(privatePage||!config?.enabled||!measurementPage())return null;
 return <a href="/webinar/privacy#advertising" target="_blank" rel="noopener noreferrer" className="webinar-measurement" style={{position:'fixed',left:12,bottom:12,zIndex:60,borderRadius:12,padding:'6px 9px',background:'#fff',border:'1px solid #e0e0e0',fontFamily:'Arial,sans-serif',fontSize:11,color:'#262626'}}>Ad privacy</a>;
}
