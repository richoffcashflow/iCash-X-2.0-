'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check} from 'lucide-react';
import {safeVipSession} from '@/lib/webinar-purchase-flow';
import {installWebinarExitReminder,navigateWebinar} from '@/lib/webinar-exit-reminder';

/** Mounted only after billing confirms Standard access and a published VIP destination. */
export function WebinarVipWelcome({href,fullScreen=false}:{href:string;fullScreen?:boolean}){
 const destination=safeVipSession(href),[seconds,setSeconds]=useState(5);
 const heading=useRef<HTMLHeadingElement>(null),remaining=useRef(5),navigated=useRef(false);
 function open(){if(!destination||navigated.current)return;navigated.current=true;navigateWebinar(destination);}
 function workspace(){if(navigated.current)return;navigated.current=true;navigateWebinar('/access');}
 useEffect(()=>{
  heading.current?.focus({preventScroll:true});
  if(!destination)return;
  const stopReminder=installWebinarExitReminder(()=>!navigated.current);
  remaining.current=5;setSeconds(5);
  const id=setInterval(()=>{
   if(document.hidden||navigated.current)return;
   remaining.current=Math.max(0,remaining.current-1);setSeconds(remaining.current);
   if(remaining.current===0){open();clearInterval(id);}
  },1000);
  return()=>{clearInterval(id);stopReminder();};
 },[destination]);
 if(!destination)return null;
 return <section className={`webinar-vip-welcome${fullScreen?' webinar-vip-welcome-full':''}`} aria-labelledby="vip-welcome-title">
  <div className="webinar-vip-welcome-content">
   <p className="purchase-receipt" role="status"><Check size={18} aria-hidden="true"/>Payment confirmed</p>
   <span className="webinar-vip-welcome-label">YOUR NEXT STEP · VIP WEBINAR</span>
   <h2 id="vip-welcome-title" ref={heading} tabIndex={-1}>Don’t leave yet.</h2>
   <p className="webinar-vip-welcome-message">Stay here to watch your VIP webinar.</p>
   <p>Your iCash X purchase is complete. See what VIP adds in your next video.</p>
   <button type="button" className="setup-primary" onClick={open}>Watch VIP now<ArrowRight size={19} aria-hidden="true"/></button>
   <button type="button" className="membership-embedded-back" onClick={workspace}>Open my workspace</button>
   <p className="webinar-vip-welcome-countdown" role="timer" aria-live="off">{seconds>0?`Starting automatically in ${seconds} seconds…`:'Opening your VIP webinar…'}</p>
  </div>
 </section>;
}
