'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';
type Checkout={mount:(node:HTMLElement)=>void;destroy:()=>void};
type StripeClient={createEmbeddedCheckoutPage:(options:{clientSecret:string;onComplete:()=>void})=>Promise<Checkout>};
declare global{interface Window{Stripe?:(key:string)=>StripeClient}}
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
  if(!ready||!host.current||!window.Stripe)return;
  let disposed=false,checkout:Checkout|undefined;setError('');
  const node=host.current;
  void window.Stripe(publishableKey).createEmbeddedCheckoutPage({clientSecret,onComplete:()=>{if(!disposed)complete.current();}}).then(instance=>{if(disposed){instance.destroy();return;}checkout=instance;instance.mount(node);mounted.current?.();}).catch(()=>{if(!disposed)setError('The payment form could not load. Your payment has not been retried.');});
  return()=>{disposed=true;checkout?.destroy();};
 },[ready,clientSecret,publishableKey,attempt]);
 // onLoad also handles a script download already started by the checkout loader.
 return <div className="membership-embedded"><Script src="https://js.stripe.com/endive/stripe.js" strategy="afterInteractive" onReady={()=>{if(window.Stripe)setReady(true);}} onLoad={()=>{if(window.Stripe)setReady(true);else setError('The secure payment connection could not load. Check your connection and reload.');}} onError={()=>setError('The secure payment connection could not load. Check your connection and reload.')}/>{!ready&&!error&&<p role="status">Loading secure payment…</p>}<div ref={host} className="stripe-embedded-host"/>{error&&<p className="stripe-embedded-error" role="alert">{error} {ready&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Reload payment form</button>}</p>}</div>;
}
