'use client';
import {useRef,useState,type FormEvent} from 'react';
import {IcashMark} from '@/components/icash-mark';
export function PrivateAccess({available,unavailable=false}:{available:boolean;unavailable?:boolean}){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const running=useRef(false);
 async function submit(event:FormEvent){
  event.preventDefault();if(running.current)return;running.current=true;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/private-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sent?{action:'verify',email,code}:{action:'email',email}),signal:AbortSignal.timeout(45000)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Please try again.');
   if(result.signedIn){window.location.assign('/');return;}
   setSent(true);setMessage('Your code is on its way. Check your inbox and spam folder.');
  }catch(error){setMessage(error instanceof Error&&error.name!=='TimeoutError'?error.message:'This took longer than expected. Request a new code and try again.');}
  finally{running.current=false;setBusy(false);}
 }
 return <main className="private-access-page"><a className="private-access-brand" href="/" aria-label="iCash X home"><IcashMark/></a><section className="private-access-card">
  <p className="private-access-kicker">ICASH X 2.0 · PRIVATE INVITATION</p>
  {available?<><h1>{sent?'Check your email.':'Your account. On us.'}</h1><p>{sent?`Enter the code sent to ${email}.`:'Create your account with free Standard software access. No card. No monthly subscription.'}</p>
   <form onSubmit={submit}>{sent?<><label htmlFor="invite-code">Verification code</label><input autoFocus id="invite-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} disabled={busy}/></>:<><label htmlFor="invite-email">Your email</label><input autoFocus id="invite-email" name="email" type="email" autoComplete="email" maxLength={320} required placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></>}
    <button className="private-access-submit" disabled={busy}>{busy?'One moment…':sent?'Create my free account':'Continue with email'}</button>
   </form>
   {sent&&<button className="private-access-change" disabled={busy} onClick={()=>{setSent(false);setCode('');setMessage('');}}>Change email or request a new code</button>}
   {message&&<p className="private-access-message" role="status">{message}</p>}
   <p className="private-access-note">Work credits are separate. Add them when you’re ready to run your bot.</p>
  </>:<><h1>{unavailable?'Please try again.':'An invitation is needed.'}</h1><p>{unavailable?'We couldn’t check your invitation. Refresh this page in a moment.':'Open the private link you were sent to create your free account.'}</p><a href="/">Already have an account? Sign in</a></>}
 </section><a className="private-access-help" href="/support">Need help?</a></main>;
}
