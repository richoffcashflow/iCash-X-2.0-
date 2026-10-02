'use client';
import {useEffect,useRef,useState} from 'react';
const endpoint='/api/owner-inbound-acceptance/audio-once/phone-pin';
const storageKey='icash-owner-audio-phone-pin-review-v1';
type Review={status:string;message:string;reviewToken?:string|null;expiresAt?:string|null;restoreExpiresAt?:string|null};
export default function OwnerAudioPhonePin(){
 const [review,setReview]=useState<Review|null>(null),[token,setToken]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef(false);
 useEffect(()=>{try{const saved=sessionStorage.getItem(storageKey);if(saved&&saved.length<16000){setToken(saved);setMessage('A saved routing review is available. Check assignment before taking another action.');}}catch{}},[]);
 async function run(action?:'pin'|'restore'|'inspect'){
  if(active.current||action&&!token)return;active.current=true;setBusy(true);setMessage('');if(action==='pin'||action==='restore')setReview(null);
  try{
   const response=await fetch(endpoint,{method:action?'POST':'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(35000),...(action?{headers:{'Content-Type':'application/json'},body:JSON.stringify({action,reviewToken:token})}:{})});
   const result:Review=await response.json();
   if(!result||typeof result.status!=='string'||typeof result.message!=='string')throw Error();
   if(!response.ok){setMessage(result.message);return;}
   setReview(result);setMessage(result.message);
   if(typeof result.reviewToken==='string'&&result.reviewToken.length<16000){setToken(result.reviewToken);try{sessionStorage.setItem(storageKey,result.reviewToken);}catch{setMessage(result.message+' The saved original can be recovered with the routing review button.');}}
   if(result.status==='restored'){setToken(null);try{sessionStorage.removeItem(storageKey);}catch{}}
  }catch{setMessage('The routing result is uncertain. Do not repeat the change. Check assignment using the saved review.');}
  finally{active.current=false;setBusy(false);}
 }
 return <section aria-label="Temporary audio test routing" style={{maxWidth:650,margin:'2rem auto',padding:'1.5rem',border:'1px solid currentColor',borderRadius:12}}>
  <h2>Temporary test routing</h2>
  <p>Temporarily pin the incoming phone to the isolated 60-second, no-business-tools branch. This changes where incoming calls go until the original assignment is restored. It does not place a call or arm the one-use test.</p>
  <button disabled={busy||!!token} onClick={()=>void run()}>Review temporary phone routing</button>
  {token&&<><p><button disabled={busy} onClick={()=>void run('inspect')}>Check current phone assignment</button></p>{review?.status==='ready'&&<p><button disabled={busy} onClick={()=>void run('pin')}>Apply temporary test routing</button></p>}<p><button disabled={busy} onClick={()=>void run('restore')}>Restore original phone assignment</button></p></>}
  <p role="status">{message}</p>
  <p>After the test, cancellation or expiry, restore the original assignment promptly. The original assignment review is saved on the server before pinning and can be recovered with the review button after reopening this page. A failed webhook’s call-rejection behavior has not been independently proven; the pinned default still has the 60-second cap and no business tools.</p>
 </section>;
}
