'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';
type Checkout={mount:(node:HTMLElement)=>void;destroy:()=>void};
type StripeClient={createEmbeddedCheckoutPage:(options:{clientSecret:string;onComplete:()=>void})=>Promise<Checkout>};
declare global{interface Window{Stripe?:(key:string)=>StripeClient}}
export function StripeEmbeddedCheckout({clientSecret,publishableKey,onComplete}:{clientSecret:string;publishableKey:string;onComplete:()=>void}){
 const host=useRef<HTMLDivElement>(null),complete=useRef(onComplete);complete.current=onComplete;
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!ready||!host.current||!window.Stripe)return;
  let disposed=false,checkout:Checkout|undefined;setError('');
  const node=host.current;
  void window.Stripe(publishableKey).createEmbeddedCheckoutPage({clientSecret,onComplete:()=>{if(!disposed)complete.current();}}).then(instance=>{if(disposed){instance.destroy();return;}checkout=instance;instance.mount(node);}).catch(()=>{if(!disposed)setError('The payment form could not load. Your payment has not been retried.');});
  return()=>{disposed=true;checkout?.destroy();};
 },[ready,clientSecret,publishableKey,attempt]);
 return <div className="membership-embedded"><Script src="https://js.stripe.com/endive/stripe.js" strategy="afterInteractive" onReady={()=>setReady(true)} onError={()=>setError('The secure payment connection could not load. Check your connection and reload.')}/>{!ready&&!error&&<p role="status">Loading secure payment…</p>}<div ref={host} className="stripe-embedded-host"/>{error&&<p className="stripe-embedded-error" role="alert">{error} {ready&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Reload payment form</button>}</p>}</div>;
}
