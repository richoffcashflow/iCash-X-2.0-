'use client';
import {useEffect,useRef,useState} from 'react';
import type {VoiceConversation as VoiceSession} from '@elevenlabs/client';
import type {voiceResult} from '@/lib/voice-result';
type Result=NonNullable<ReturnType<typeof voiceResult>>;
export default function VoiceTest(){
 const [access,setAccess]=useState('');const [phase,setPhase]=useState('ready');const [message,setMessage]=useState('');
 const [sessionId,setSessionId]=useState('');const [result,setResult]=useState<Result|null>(null);
 const [lines,setLines]=useState<{role:string;text:string}[]>([]);
 const call=useRef<VoiceSession|null>(null);const starting=useRef(false);const mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;
  const token=new URLSearchParams(location.hash.slice(1)).get('access');
  if(token&&/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem('icash_voice_test_access',token);history.replaceState(null,'',location.pathname);}
  setAccess(sessionStorage.getItem('icash_voice_test_access')??'');
  const previous=sessionStorage.getItem('icash_voice_test_session');
  if(previous){setSessionId(previous);setPhase('ended');}
  return()=>{mounted.current=false;void call.current?.endSession();call.current=null;};
 },[]);
 async function start(){
  if(starting.current||call.current)return;starting.current=true;setPhase('connecting');setMessage('');setResult(null);setLines([]);
  try{
   // Ask for microphone permission before spending the limited session allowance.
   const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(t=>t.stop());
   if(!mounted.current)return;
   const r=await fetch('/api/voice-test/session',{method:'POST',headers:{Authorization:`Bearer ${access}`}});const data=await r.json();
   if(!r.ok)throw new Error(data.error||'Could not start this test.');
   setSessionId(data.sessionId);sessionStorage.setItem('icash_voice_test_session',data.sessionId);
   const {VoiceConversation}=await import('@elevenlabs/client');
   const active=await VoiceConversation.startSession({conversationToken:data.conversationToken,connectionType:'webrtc',
    onMessage:m=>setLines(old=>[...old,{role:m.source==='user'?'You':'Alex',text:m.message}]),
    onDisconnect:()=>{call.current=null;if(mounted.current)setPhase('ended');},
    onError:()=>{if(mounted.current)setMessage('The voice connection had a problem. End the test and check the saved result.');}
   });
   if(!mounted.current){await active.endSession();return;}
   call.current=active;setPhase('talking');
  }catch(e){if(mounted.current){setPhase('ended');setMessage(e instanceof Error&&e.name==='NotAllowedError'?'Allow microphone access to try the voice conversation.':e instanceof Error?e.message:'Could not connect.');}}
  finally{starting.current=false;}
 }
 async function stop(){setPhase('ending');try{await call.current?.endSession();}finally{call.current=null;setPhase('ended');}}
 async function check(){
  setPhase('checking');setMessage('');
  try{
   const r=await fetch(`/api/voice-test/result?session=${encodeURIComponent(sessionId)}`,{headers:{Authorization:`Bearer ${access}`},cache:'no-store'});const data=await r.json();
   if(!r.ok)throw new Error(data.error);
   if(data.status==='complete'){setResult(data.result);setPhase('complete');}
   else{setPhase('ended');setMessage(data.status==='failed'?'The provider could not finish this conversation.':'The summary is still processing. Check again in a few seconds.');}
  }catch(e){setPhase('ended');setMessage(e instanceof Error?e.message:'Unable to fetch the result.');}
 }
 const busy=['connecting','ending','checking'].includes(phase);
 return <main style={{maxWidth:520,margin:'0 auto',padding:'32px 20px 60px',color:'#111',background:'#fff',minHeight:'100dvh'}}>
  <p style={{fontSize:13,fontWeight:700,letterSpacing:1}}>iCASH X · PRIVATE TEST</p>
  <h1 style={{fontSize:32,lineHeight:1.15,margin:'22px 0 12px'}}>Talk to your AI bot.</h1>
  <p style={{fontSize:17,lineHeight:1.6,color:'#555'}}>Pretend you’re a seller. Ask Alex to call back on a specific date and time. Then check what it remembered.</p>
  <p style={{fontSize:14,color:'#666',margin:'14px 0 24px'}}>Up to 3 minutes. Your voice is processed by ElevenLabs; a transcript is saved for this test. No sellers are contacted and no customer credits are used.</p>
  {!access?<p role="alert">Open the private test link provided to you.</p>:<>
   <button disabled={busy} onClick={phase==='talking'?stop:start} style={{width:'100%',minHeight:56,border:0,borderRadius:16,background:'#111',color:'#fff',fontSize:18,fontWeight:650,opacity:busy?.5:1}}>{phase==='talking'?'End conversation':phase==='connecting'?'Connecting…':phase==='ending'?'Ending…':'Start voice test'}</button>
   {sessionId&&phase!=='talking'&&<button onClick={check} disabled={busy} style={{width:'100%',minHeight:52,marginTop:12,border:'1px solid #ddd',borderRadius:16,background:'#fff',fontSize:17}}>{phase==='checking'?'Checking…':'See summary & callback'}</button>}
  </>}
  <p role="status" style={{lineHeight:1.5,marginTop:16}}>{phase==='talking'?'🎙️ Connected — speak naturally.':message}</p>
  {result&&<section style={{padding:20,background:'#f5f5f5',borderRadius:18,marginTop:24}}>
   <h2 style={{fontSize:20,margin:'0 0 12px'}}>What Alex remembered</h2><p style={{lineHeight:1.6}}>{result.summary}</p>
   <p style={{fontWeight:650,marginTop:18}}>{result.callbackStatus==='scheduled_test'?'📅 Practice callback saved':result.callbackStatus==='blocked_opt_out'?'Contact stopped':result.callbackStatus==='needs_confirmation'?'Callback needs a confirmed date, time and timezone':'No callback requested'}</p>
   {result.dueAt&&<p>{new Date(result.dueAt).toLocaleString('en-US',{timeZone:result.timezone??'UTC',dateStyle:'full',timeStyle:'short'})} · {result.timezone}</p>}
   <p style={{fontSize:13,color:'#666',marginTop:14}}>Test record only. No callback will be dialed.</p>
   <details style={{marginTop:16}}><summary style={{minHeight:44,cursor:'pointer'}}>View saved transcript</summary>{result.transcript.map((t,i)=><p key={i} style={{lineHeight:1.6,marginBottom:12}}><strong>{t.role==='user'?'You':'Alex'}:</strong> {t.message}</p>)}</details>
  </section>}
  {!result&&lines.length>0&&<section aria-label="Live conversation" style={{marginTop:24}}>{lines.map((line,i)=><p key={i} style={{padding:14,borderRadius:16,background:line.role==='You'?'#111':'#f3f3f3',color:line.role==='You'?'#fff':'#111',margin:'10px 0',lineHeight:1.5}}><strong>{line.role}</strong><br/>{line.text}</p>)}</section>}
 </main>;
}
