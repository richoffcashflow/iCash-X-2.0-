'use client';
import {useEffect,useRef,useState} from 'react';
import {Users} from 'lucide-react';

export function WebinarAudience({sessionId,enabled,preview,playing}:{sessionId:string;enabled:boolean;preview:boolean;playing:boolean}){
 const [count,setCount]=useState<number|null>(null),tab=useRef(''),sequence=useRef(0);
 useEffect(()=>{
  if(!enabled||preview)return;
  if(!tab.current)tab.current=crypto.randomUUID();
  let disposed=false;
  function update(leave=false){
   const body=JSON.stringify({sessionId,tabId:tab.current,sequence:++sequence.current,watching:!leave&&playing&&!document.hidden});
   if(leave){navigator.sendBeacon('/api/webinar/audience',new Blob([body],{type:'application/json'}));return;}
   const sent=sequence.current;
   void fetch('/api/webinar/audience',{method:'POST',headers:{'Content-Type':'application/json'},body}).then(async response=>{if(!response.ok)throw Error('Count unavailable');return response.json();}).then(data=>{if(!disposed&&sent===sequence.current)setCount(Number.isSafeInteger(data.count)&&data.count>=0?data.count:null);}).catch(()=>{if(!disposed)setCount(null);});
  }
  const visibility=()=>{if(document.hidden){update(true);setCount(null);}else update();},leave=()=>update(true);
  update();const interval=setInterval(()=>{if(!document.hidden)update();},30000);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leave);
  return()=>{disposed=true;clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);update(true);};
 },[sessionId,enabled,preview,playing]);
 if(!enabled||preview||count===null||count===0)return null;
 return <span className="wb-audience" title="Active viewers of this recording. Updated every 30 seconds; inactive connections expire within 75 seconds."><Users size={14}/><b>{count.toLocaleString()}</b> watching now</span>;
}
