'use client';
import {useEffect,useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {Check,X} from 'lucide-react';
import {activityMessage,recordedPurchaseMessage,recentActivity,type WebinarActivity} from '@/lib/webinar-activity';
import {webinarSite} from '@/lib/webinar-site';

export function WebinarPurchaseNotifications({sessionId,enabled,preview,intervalSeconds,onActivity,replayPurchase=null,vip=false}:{onActivity?:()=>void;sessionId:string;enabled:boolean;preview:boolean;intervalSeconds:number;replayPurchase?:{name:string;at:number;location?:string}|null;vip?:boolean}){
 const [active,setActive]=useState<WebinarActivity|null>(null),[muted,setMuted]=useState(false);
 const recorded=useRef(replayPurchase);recorded.current=replayPurchase;
 const notify=useRef(onActivity);notify.current=onActivity;
 useEffect(()=>{if(active)notify.current?.();},[active]);
 const seen=useRef(new Set<string>()),nextAt=useRef(0);
 const storageKey=`webinar-activity:${sessionId}`;
 useEffect(()=>{
  try{const data=JSON.parse(sessionStorage.getItem(storageKey)||'{}');seen.current=new Set(Array.isArray(data.seen)?data.seen.filter((id:unknown)=>typeof id==='string').slice(-200):[]);setMuted(data.muted===true);}catch{seen.current=new Set();}
 },[storageKey]);
 useEffect(()=>{
  if(!enabled||preview||muted)return;
  let disposed=false,busy=false,hide:ReturnType<typeof setTimeout>|undefined,currentId='';
  const controller=new AbortController();
  async function refresh(){
   if(busy||document.hidden)return;
   busy=true;
   try{
    const data=await webinarRequest<{events:WebinarActivity[];serverNow:number}>('/api/webinar/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId}),signal:controller.signal},10000);
    if(disposed)return;
    const events=recentActivity(data.events,data.serverNow);
    if(currentId&&!events.some(event=>event.id===currentId)){setActive(null);currentId='';}
    if(currentId||recorded.current||Date.now()<nextAt.current)return;
    const event=events.find(event=>!seen.current.has(event.id));if(!event)return;
    seen.current.add(event.id);seen.current=new Set([...seen.current].slice(-200));
    try{sessionStorage.setItem(storageKey,JSON.stringify({seen:[...seen.current],muted:false}));}catch{/* Notifications still work without browser storage. */}
    nextAt.current=Date.now()+intervalSeconds*1000;currentId=event.id;setActive(event);
    hide=setTimeout(()=>{setActive(null);currentId='';},6000);
   }catch{/* A delayed or unavailable payment feed stays quiet. */}finally{busy=false;}
  }
  const visibility=()=>{if(document.hidden){setActive(null);currentId='';if(hide)clearTimeout(hide);}else void refresh();};
  void refresh();const timer=setInterval(()=>void refresh(),15000);
  document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;controller.abort();clearInterval(timer);if(hide)clearTimeout(hide);document.removeEventListener('visibilitychange',visibility);setActive(null);};
 },[sessionId,enabled,preview,muted,intervalSeconds,storageKey]);
 function dismiss(){setMuted(true);setActive(null);try{sessionStorage.setItem(storageKey,JSON.stringify({seen:[...seen.current],muted:true}));}catch{/* Optional preference storage. */}}
 const replay=muted?null:replayPurchase,verified=!muted&&!preview&&enabled&&!replay?active:null;
 return <div className="wb-purchase-toast-region" data-vip={vip||undefined} role="status" aria-live="polite" aria-atomic="true">{(replay||verified)&&<div className="wb-activity" key={replay?`replay:${replay.at}:${replay.name}`:verified!.id}><span className="wb-activity-check"><Check size={19}/></span><div><strong>{replay?recordedPurchaseMessage(replay.name,vip):activityMessage(verified!)}</strong><small>{replay?'Recorded activity':`Recent ${webinarSite.brandName} activity`}</small>{!replay&&verified?.region&&<small className="wb-activity-location">Approximate location</small>}</div><button className="wb-icon" aria-label="Hide purchase updates for this session" onClick={dismiss}><X size={16}/></button></div>}</div>;
}
