'use client';
import {useEffect,useRef,useState} from 'react';
import {loadCheckoutStripe,type EmbeddedCheckout} from '@/lib/stripe-checkout-client';
export function StripeEmbeddedCheckout({clientSecret,publishableKey,onComplete,onReady,onInteract}:{clientSecret:string;publishableKey:string;onComplete:()=>void;onReady?:()=>void;onInteract?:()=>void}){
 const host=useRef<HTMLDivElement>(null),complete=useRef(onComplete);complete.current=onComplete;
 const mounted=useRef(onReady);mounted.current=onReady;
 const interaction=useRef(onInteract);interaction.current=onInteract;const watchInteraction=!!onInteract;
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!watchInteraction)return;
  let timer:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined,detected=false;
  // Focus events inside Stripe's cross-origin iframe do not bubble to React.
  // Observe only focus entering our iframe; never inspect payment fields.
  const inspect=()=>{if(detected||document.hidden)return;const node=document.activeElement;if(node?.tagName==='IFRAME'&&host.current?.contains(node)){detected=true;clearInterval(poll);interaction.current?.();}};
  const focus=()=>{inspect();clearTimeout(timer);if(!detected)timer=setTimeout(inspect,0);};
  window.addEventListener('blur',focus);
  document.addEventListener('focusin',focus);
  // Some webviews keep the outer window blurred across navigation. Observe
  // iframe focus until the first interaction, without reading payment fields.
  poll=setInterval(inspect,250);
  return()=>{clearTimeout(timer);clearInterval(poll);window.removeEventListener('blur',focus);document.removeEventListener('focusin',focus);};
 },[watchInteraction,clientSecret]);
 useEffect(()=>{
  if(!host.current)return;
  let disposed=false,expired=false,checkout:EmbeddedCheckout|undefined,timer:ReturnType<typeof setTimeout>|undefined;setError('');setReady(false);
  const node=host.current;
  void loadCheckoutStripe().then(stripe=>{
   if(disposed)return;
   timer=setTimeout(()=>{expired=true;if(!disposed)setError('The payment form could not load. Your payment has not been retried.');},20000);
   return stripe(publishableKey).createEmbeddedCheckoutPage({clientSecret,onComplete:()=>{if(!disposed&&!expired)complete.current();}}).then(instance=>{
    clearTimeout(timer);if(disposed||expired){instance.destroy();return;}
    checkout=instance;instance.mount(node);setReady(true);mounted.current?.();
   });
  }).catch(e=>{clearTimeout(timer);if(!disposed)setError(e instanceof Error&&e.message.startsWith('The secure payment connection')?e.message:'The payment form could not load. Your payment has not been retried.');});
  return()=>{disposed=true;clearTimeout(timer);checkout?.destroy();};
 },[clientSecret,publishableKey,attempt]);
 // Recovery remounts this exact client secret; it never creates or retries a payment.
 return <div className="membership-embedded">{!ready&&!error&&<p role="status">Loading secure payment…</p>}<div ref={host} className="stripe-embedded-host"/>{error&&<p className="stripe-embedded-error" role="alert">{error} <button type="button" onClick={()=>setAttempt(n=>n+1)}>Reload payment form</button></p>}</div>;
}
