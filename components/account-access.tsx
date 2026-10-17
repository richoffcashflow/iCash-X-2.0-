"use client";
import {useEffect,useRef,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
export function AccountAccess({initialEmail='',onSignedIn,ready=true}:{initialEmail?:string;onSignedIn:()=>void;ready?:boolean}){
 const [email,setEmail]=useState(initialEmail),[phone,setPhone]=useState(''),[channel,setChannel]=useState<'email'|'sms'>('email');
 const [code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[cooldown,setCooldown]=useState(0);
 const inFlight=useRef(false);
 useEffect(()=>{if(cooldown<=0)return;const timer=setTimeout(()=>setCooldown(value=>Math.max(0,value-1)),1000);return()=>clearTimeout(timer);},[cooldown]);
 async function perform(action:'send'|'verify'){
  if(inFlight.current||action==='send'&&cooldown>0)return;
  inFlight.current=true;setBusy(true);setMessage('');
  try{
   const path=channel==='sms'?'/api/auth/phone':action==='verify'?'/api/auth/verify':'/api/auth/email';
   const body=channel==='sms'?{action,email,phone,code,accepted:action==='send'}:{email,code};
   const data=await workspaceRequest<{message?:string}>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(action==='verify')onSignedIn();else{setSent(true);setCode('');setCooldown(60);setMessage(data.message??'Check for your code.');}
  }catch(error){
   // A send may have succeeded before its response was lost. Keep code entry reachable.
   if(action==='send'){setSent(true);setCooldown((error as {status?:number})?.status===429?600:60);}
   setMessage(error instanceof Error?error.message:'Please try again.');
  }finally{inFlight.current=false;setBusy(false);}
 }
 function choose(next:'email'|'sms'){setChannel(next);setSent(false);setCode('');setMessage('');setCooldown(0);}
 const emailInbox=/@(icloud|me|mac)\.com$/i.test(email.trim())?'https://www.icloud.com/mail':/@gmail\.com$/i.test(email.trim())?'https://mail.google.com':null;
 return <form className="account-access" onSubmit={async event=>{event.preventDefault();await perform(sent?'verify':'send');}}>
  <p>{channel==='sms'?'Use your payment email and the mobile number from checkout.':'Enter your account or payment email. No password needed.'}</p>
  {!ready&&channel==='email'&&<p role="status">Email sign-in is temporarily unavailable. Try your checkout phone below.</p>}
  <label>Email<input type="email" autoComplete="email" required value={email} disabled={sent||busy} onChange={event=>setEmail(event.target.value)}/></label>
  {channel==='sms'&&<><label>Checkout mobile number<input type="tel" autoComplete="tel" required value={phone} disabled={sent||busy} onChange={event=>setPhone(event.target.value)} placeholder="(555) 555-1234"/></label><p className="sign-in-help">Choose “Text me a code” to request one sign-in text. Reply STOP to opt out.</p></>}
  {sent&&<>
   <p className="sign-in-help">{channel==='email'?<>Check the inbox and Junk/Spam for <strong>{email}</strong>. Look for <strong>“Your iCash X sign-in code”</strong> from <strong>signin@geticashx.com</strong>. {emailInbox&&<a href={emailInbox} target="_blank" rel="noopener noreferrer">Open your email inbox</a>}</>:<>Enter the 8-digit code sent to your checkout mobile number. It expires in 10 minutes.</>} Use the newest code. Your payment is saved—do not pay again.</p>
   <label>{channel==='sms'?'Text code':'Email code'}<input inputMode="numeric" autoComplete="one-time-code" pattern={channel==='sms'?'[0-9]{8}':'[0-9]{6,10}'} required maxLength={channel==='sms'?8:10} value={code} onChange={event=>setCode(event.target.value.replace(/\s/g,''))}/></label>
  </>}
  <button className="fund-button full" disabled={busy||!sent&&cooldown>0||channel==='email'&&!ready}>{busy?'One moment…':sent?'Sign in':channel==='sms'?'Text me a code':'Email me a code'}</button>
  {sent?<>
   <button type="button" className="demo-button" disabled={busy||cooldown>0} onClick={()=>void perform('send')}>{cooldown>0?`Resend in ${Math.floor(cooldown/60)}:${String(cooldown%60).padStart(2,'0')}`:'Send a new code'}</button>
   <button type="button" className="demo-button" disabled={busy} onClick={()=>choose(channel)}>Use another email or resend</button>
  </>:<button type="button" className="demo-button" disabled={busy} onClick={()=>setSent(true)}>I already have a code</button>}
  <button type="button" className="demo-button" disabled={busy} onClick={()=>choose(channel==='email'?'sms':'email')}>{channel==='email'?'Use my checkout phone':'Use email instead'}</button>
  {message&&<p role="status">{message}</p>}
  <p className="sign-in-help"><a href="/access/help">Still need help getting in?</a></p>
 </form>;
}
