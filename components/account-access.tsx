"use client";
import {useEffect,useRef,useState} from 'react';
import {webinarRequest as workspaceRequest} from '@/lib/webinar-client';
export function AccountAccess({initialEmail='',onSignedIn,ready=true,trialRecovery=false}:{initialEmail?:string;onSignedIn:()=>void;ready?:boolean;trialRecovery?:boolean}){
 const [email,setEmail]=useState(initialEmail);
 const [code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[cooldown,setCooldown]=useState(0);
 const inFlight=useRef(false);
 useEffect(()=>{if(cooldown<=0)return;const timer=setTimeout(()=>setCooldown(value=>Math.max(0,value-1)),1000);return()=>clearTimeout(timer);},[cooldown]);
 async function perform(action:'send'|'verify'){
  if(inFlight.current||action==='send'&&cooldown>0)return;
  inFlight.current=true;setBusy(true);setMessage('');
  try{
   const path=action==='verify'?'/api/auth/verify':'/api/auth/email';
   const body={email,code};
   const data=await workspaceRequest<{message?:string}>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(action==='verify')onSignedIn();else{setSent(true);setCode('');setCooldown(60);setMessage(data.message??'Check for your code.');}
  }catch(error){
   // A send may have succeeded before its response was lost. Keep code entry reachable.
   if(action==='send'){setSent(true);setCooldown((error as {status?:number})?.status===429?600:60);}
   setMessage(error instanceof Error?error.message:'Please try again.');
  }finally{inFlight.current=false;setBusy(false);}
 }
 function changeEmail(){setSent(false);setCode('');setMessage('');setCooldown(0);}
 const emailInbox=/@(icloud|me|mac)\.com$/i.test(email.trim())?'https://www.icloud.com/mail':/@gmail\.com$/i.test(email.trim())?'https://mail.google.com':null;
 return <form className="account-access" onSubmit={async event=>{event.preventDefault();await perform(sent?'verify':'send');}}>
  <p>{trialRecovery?'Verify the email used for your unfinished introductory checkout. This verifies your email only; it does not activate access or charge your payment method.':'Already paid? Use the email on your payment receipt. Returning users can use their account email. No password needed.'}</p>
  {!ready&&<p role="status">Email sign-in is temporarily unavailable. Please try again later or contact support below.</p>}
  <label>Email<input type="email" autoComplete="email" required value={email} disabled={sent||busy} onChange={event=>setEmail(event.target.value)}/></label>
  {sent&&<>
   <p className="sign-in-help">Check the inbox and Junk/Spam for <strong>{email}</strong>. Look for <strong>“Your iCash X sign-in code”</strong> from <strong>signin@geticashx.com</strong>. {emailInbox&&<a href={emailInbox} target="_blank" rel="noopener noreferrer">Open your email inbox</a>} Use the newest code. {trialRecovery?'Return to the offer after verification to resume your checkout.':'Your payment is saved—do not pay again.'}</p>
   <label>Email code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required maxLength={10} value={code} onChange={event=>setCode(event.target.value.replace(/\s/g,''))}/></label>
  </>}
  <button className="fund-button full" disabled={busy||!sent&&cooldown>0||!ready}>{busy?'One moment…':sent?'Sign in':'Email me a code'}</button>
  {sent?<>
   <p className="sign-in-help">{trialRecovery?'No code? Check the email used for your unfinished checkout and your spam folder.':'No code? Check that the email above matches your payment receipt and check Junk/Spam. If the receipt email is wrong or inaccessible, contact support for purchase verification.'}</p>
   <button type="button" className="demo-button" disabled={busy||cooldown>0} onClick={()=>void perform('send')}>{cooldown>0?`Resend in ${Math.floor(cooldown/60)}:${String(cooldown%60).padStart(2,'0')}`:'Send a new code'}</button>
   <button type="button" className="demo-button" disabled={busy} onClick={changeEmail}>Use another email or resend</button>
  </>:<button type="button" className="demo-button" disabled={busy} onClick={()=>setSent(true)}>I already have a code</button>}
  {message&&<p role="status">{message}</p>}
  <p className="sign-in-help"><a href="/access/help">Still need help getting in?</a></p>
 </form>;
}
