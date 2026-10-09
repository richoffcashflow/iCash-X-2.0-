'use client';
import {useEffect,useRef,useState} from 'react';
import {webinarRequest,webinarBeacon} from '@/lib/webinar-client';
import {Users,Info} from 'lucide-react';
import {simulatedAudience,type AudienceDisplay} from '@/packages/webinar-engine/src/index';

export function WebinarAudience({sessionId,enabled,preview,playing,display,seconds,durationSeconds}:{sessionId:string;enabled:boolean;preview:boolean;playing:boolean;display:AudienceDisplay;seconds:number;durationSeconds:number}){
 const [count,setCount]=useState<number|null>(null),tab=useRef(''),sequence=useRef(0);
 useEffect(()=>{
  if(!enabled||preview||display.mode!=='actual')return;
  if(!tab.current)tab.current=crypto.randomUUID();
  let disposed=false,busy=false;const controller=new AbortController();
  function update(leave=false){
   const body=JSON.stringify({sessionId,tabId:tab.current,sequence:++sequence.current,watching:!leave&&playing&&!document.hidden});
   if(leave){webinarBeacon('/api/webinar/audience',JSON.parse(body));return;}
   if(busy)return;busy=true;const sent=sequence.current;
   void webinarRequest<{count:number}>('/api/webinar/audience',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal},10000).then(data=>{if(!disposed&&sent===sequence.current)setCount(Number.isSafeInteger(data.count)&&data.count>=0?data.count:null);}).catch(()=>{if(!disposed)setCount(null);}).finally(()=>{busy=false;});
  }
  const visibility=()=>{if(document.hidden){update(true);setCount(null);}else update();},leave=()=>update(true);
  update();const interval=setInterval(()=>{if(!document.hidden)update();},30000);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leave);
  return()=>{disposed=true;controller.abort();clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);update(true);};
 },[sessionId,enabled,preview,playing,display.mode]);
 const simulated=simulatedAudience(display,sessionId,seconds,durationSeconds);
 if(enabled&&simulated!==null)return <div className="wb-audience"><Users size={14} aria-hidden="true"/><b>{simulated.toLocaleString()}</b><span>viewers</span><details className="wb-audience-info"><summary aria-label="About the viewer count"><Info size={15} aria-hidden="true"/></summary><p>This audience display is generated from a number set by the host. It is not a count of people currently watching.</p></details></div>;
 if(!enabled||preview||count===null||count===0)return null;
 return <span className="wb-audience" title="Active viewers of this recording. Updated every 30 seconds; inactive connections expire within 75 seconds."><Users size={14}/><b>{count.toLocaleString()}</b> live attendees</span>;
}
