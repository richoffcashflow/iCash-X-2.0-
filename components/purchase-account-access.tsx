'use client';
import {useEffect,useRef,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {IcashMark} from '@/components/icash-mark';

export function PurchaseAccountAccess(){
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[signedIn,setSignedIn]=useState(false),[ready,setReady]=useState(true);
 const alive=useRef(true),busy=useRef(false);
 async function restore(){
  if(busy.current)return;busy.current=true;setLoading(true);setError('');
  try{
   const source=new URLSearchParams(window.location.search),query=new URLSearchParams();
   for(const key of ['purchase','destination']){const value=source.get(key);if(value)query.set(key,value);}
   const response=await fetch('/api/account/access?'+query,{cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await response.json();
   if(!alive.current)return;
   setSignedIn(data.signedIn===true);setReady(data.signInReady!==false);
   if(!response.ok)throw Error(data.error||'Please try again. Your payment is saved.');
   if(data.signedIn){
    // Only app-owned destinations can leave this page. Query input is never a redirect.
    if(data.destination!=='/'&&!/^\/live\/\d{6,12}$/.test(data.destination??''))throw Error('Your access link could not be opened. Please contact support.');
    window.location.assign(data.destination);return;
   }
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Please try again. Your payment is saved.');}
  finally{busy.current=false;if(alive.current)setLoading(false);}
 }
 async function switchEmail(){
  setLoading(true);setError('');
  try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Could not sign out. Please retry.');setSignedIn(false);await restore();}
  catch(e){setError(e instanceof Error?e.message:'Please retry.');setLoading(false);}
 }
 useEffect(()=>{alive.current=true;void restore();return()=>{alive.current=false;};},[]);
 return <main className="purchase-access-shell"><a className="purchase-access-logo" href="/access" aria-label="iCash X account access"><IcashMark/></a><section className="purchase-access-card"><h1>Open your iCash X account.</h1><p>Use the same email you paid with to create your account or sign back in.</p><p className="purchase-access-note">Already paid? You do not need to pay again.</p>{loading?<p role="status">Checking your account…</p>:<>{error&&<p role="alert">{error}</p>}{signedIn?<><button className="fund-button full" onClick={()=>void restore()}>Try again</button><button className="demo-button" onClick={()=>void switchEmail()}>Sign in with a different email</button><a className="purchase-access-workspace" href="/">Open my workspace</a></>:<><AccountAccess ready={ready} onSignedIn={()=>void restore()}/>{error&&<button className="demo-button" onClick={()=>void restore()}>Check again</button>}</>}</>}</section><a className="purchase-access-help" href="/access/help">Need help with your purchase?</a></main>;
}
