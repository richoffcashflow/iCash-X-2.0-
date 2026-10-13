'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,MicOff,Phone,PhoneOff} from 'lucide-react';
import {BrowserCallSession,type BrowserCallPhase} from '@/lib/browser-call-session';
type Contact={phone:string;name?:string;available:boolean};
export function BrowserCallControls({screeningId,contacts,activeCall,onStarted,onFinished,onBusyChange}:{screeningId:string;contacts:Contact[];activeCall?:{id:string;connection_type?:string;ended_at:string|null};onStarted?:()=>void;onFinished:()=>void;onBusyChange?:(busy:boolean)=>void}){
 const session=useRef<BrowserCallSession|null>(null),mounted=useRef(true),finishing=useRef(false),busy=useRef(false);
 const [phase,setPhase]=useState<BrowserCallPhase>('ended'),[error,setError]=useState(''),[muted,setMuted]=useState(false),[seconds,setSeconds]=useState(0);
 const active=['connecting','ringing','connected'].includes(phase);
 const previous=activeCall&&!activeCall.ended_at&&activeCall.id!==session.current?.id?activeCall:undefined;
 useEffect(()=>{mounted.current=true;const unload=()=>{if(session.current)navigator.sendBeacon('/api/work/browser-call',new Blob([JSON.stringify({action:'end',id:session.current.id})],{type:'application/json'}));};window.addEventListener('pagehide',unload);return()=>{mounted.current=false;window.removeEventListener('pagehide',unload);void session.current?.stop();};},[]);
 useEffect(()=>{if(phase!=='connected')return;const started=Date.now(),timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[phase]);
 async function post(body:unknown){const r=await fetch('/api/work/browser-call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not connect the call.');return d;}
 async function start(phone:string){
  if(busy.current||finishing.current||previous)return;
  busy.current=true;
  setError('');setMuted(false);setSeconds(0);
  const call=new BrowserCallSession(crypto.randomUUID(),{
   microphone:async()=>{if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser cannot access a microphone. Use your phone instead.');const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop());},
   createDevice:async(token)=>{const {Device}=await import('@twilio/voice-sdk');return new Device(token,{closeProtection:true,logLevel:0});},
   request:async(action,id)=>{const result=await post(action==='end'?{action,id}:{action,requestKey:id,screeningId,phone});if(action==='end'&&mounted.current)onFinished();return result;},
   status:async(id)=>{const r=await fetch('/api/work/business-call?id='+id,{cache:'no-store'});if(!r.ok)throw Error();return r.json();},
   onState:(next,message)=>{busy.current=['connecting','ringing','connected'].includes(next);if(!mounted.current)return;onBusyChange?.(busy.current);setPhase(next);if(message)setError(message);if(next==='ended')onFinished();},
   onStarted:()=>onStarted?.(),
  });session.current=call;await call.start();
 }
 async function end(){finishing.current=true;try{if(previous)await post({action:'end',id:previous.id});else await session.current?.stop();onFinished();}catch{setError('Could not confirm the call ended. Try End call again.');}finally{finishing.current=false;}}
 return <div className="browser-call-controls">
  <p className="contact-help">Use your microphone and speakers. Keep this window open while you talk.</p>
  {previous&&<p role="status" className="contact-feedback">{previous.connection_type==='browser'?'A browser call is still open. End it before starting another.':'A phone call is already in progress.'}</p>}
  {error&&<p className="contact-alert" role="alert">{error}</p>}
  {active?<div className="browser-call-active" role="group" aria-label="Current call">
   <strong role="status">{phase==='connecting'?'Connecting…':phase==='ringing'?'Calling seller…':`On call · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}</strong>
   <div className="seller-contact-actions"><button className="contact-secondary" type="button" disabled={phase==='connecting'} aria-pressed={muted} onClick={()=>{session.current?.mute(!muted);setMuted(!muted);}}>{muted?<MicOff size={16}/>:<Mic size={16}/>} {muted?'Unmute':'Mute'}</button><button className="contact-primary" type="button" onClick={()=>void end()}><PhoneOff size={16}/>End call</button></div>
  </div>:previous?.connection_type==='browser'?<button className="contact-primary" type="button" onClick={()=>void end()}><PhoneOff size={16}/>End call</button>:contacts.filter(c=>c.available).map(c=><div className="seller-contact-card" key={c.phone}><div className="seller-contact-identity"><span className="seller-contact-avatar">{(c.name||'S').slice(0,1).toUpperCase()}</span><div><strong>{c.name||'Seller'}</strong><span>{c.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3')}</span></div></div><button className="contact-primary" type="button" data-credit-action disabled={!!previous} onClick={()=>void start(c.phone)}><Phone size={16}/>Call seller</button></div>)}
 </div>;
}
