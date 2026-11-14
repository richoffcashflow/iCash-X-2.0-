export type EmbeddedCheckout={mount:(node:HTMLElement)=>void;destroy:()=>void};
type StripeClient={createEmbeddedCheckoutPage:(options:{clientSecret:string;onComplete:()=>void})=>Promise<EmbeddedCheckout>};
type StripeFactory=(key:string)=>StripeClient;
declare global{interface Window{Stripe?:StripeFactory}}
const source='https://js.stripe.com/endive/stripe.js';
let loading:Promise<StripeFactory>|null=null;

/** Reuse the checkout preloader, but allow a failed script download to recover. */
export function loadCheckoutStripe():Promise<StripeFactory>{
 if(window.Stripe)return Promise.resolve(window.Stripe);
 if(loading)return loading;
 const request=new Promise<StripeFactory>((resolve,reject)=>{
  const existing=document.querySelector<HTMLScriptElement>(`script[src="${source}"]`);
  const script=existing??document.createElement('script');
  let settled=false;
  const clean=()=>{clearTimeout(timer);script.removeEventListener('load',loaded);script.removeEventListener('error',failed);};
  const fail=()=>{if(settled)return;settled=true;clean();script.remove();reject(Error('The secure payment connection could not load. Check your connection and reload.'));};
  const loaded=()=>{if(settled)return;if(!window.Stripe){fail();return;}settled=true;clean();resolve(window.Stripe);};
  const failed=()=>fail();
  const timer=setTimeout(()=>{if(window.Stripe)loaded();else fail();},20000);
  script.addEventListener('load',loaded);script.addEventListener('error',failed);
  if(!existing){script.src=source;script.async=true;document.head.appendChild(script);}
 });
 loading=request;
 void request.then(()=>{if(loading===request)loading=null;},()=>{if(loading===request)loading=null;});
 return request;
}
