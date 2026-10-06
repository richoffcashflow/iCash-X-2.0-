'use client';
import {useEffect,useRef,useState} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import {Check,X} from 'lucide-react';
import {activityAge,activityMessage,recentActivity,type WebinarActivity} from '@/lib/webinar-activity';
import {webinarSite} from '@/lib/webinar-site';

export function WebinarPurchaseNotifications({sessionId,enabled,preview,intervalSeconds}:{sessionId:string;enabled:boolean;preview:boolean;intervalSeconds:number}){
 const [active,setActive]=useState<WebinarActivity|null>(null),[muted,setMuted]=useState(false),[now,setNow]=useState(Date.now());
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
    const events=recentActivity(data.events,data.serverNow);setNow(data.serverNow);
    if(currentId&&!events.some(event=>event.id===currentId)){setActive(null);currentId='';}
    if(currentId||Date.now()<nextAt.current)return;
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
 return <div className="wb-activity-region" role="status" aria-live="polite" aria-atomic="true">{enabled&&!muted&&active&&<div className="wb-activity"><span className="wb-activity-check"><Check size={19}/></span><div><strong>{activityMessage(active)}</strong><small>Recent {webinarSite.brandName} activity · {activityAge(active.occurredAt,now)}</small>{active.region&&<small className="wb-activity-location">Approximate location</small>}</div><button className="wb-icon" aria-label="Hide purchase updates for this session" onClick={dismiss}><X size={16}/></button></div>}</div>;
}
