'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import {House,MessageCircle,FileCheck2} from 'lucide-react';
import {IcashMark} from '@/components/icash-mark';
import {AccountAccess} from '@/components/account-access';
import {FundingDialog} from '@/components/funding-dialog';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
import {allowWebinarNavigation} from '@/lib/webinar-exit-reminder';
import '@/app/webinar/webinar.css';
import '@/app/plan-homepage.css';
import '@/app/icash-brand.css';
import '@/app/launch-homepage.css';

type Props={preview?:boolean;previewBackHref?:string;checkingAccount?:boolean;accountError?:boolean;signInReady?:boolean;onRetry?:()=>void;onSignedIn?:()=>void};

export function WebinarExpressCheckout({preview=false,previewBackHref='/webinar-studio',checkingAccount=false,accountError=false,signInReady=true,onRetry,onSignedIn}:Props={}){
 const [webinarSessionId,setWebinarSessionId]=useState<string>();
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('webinar_session');if(id&&/^[0-9a-f-]{36}$/i.test(id))setWebinarSessionId(id);},[]);
 const [signInOpen,setSignInOpen]=useState(false);
 useEffect(()=>{
  const active=!checkingAccount&&!preview;
  window.dispatchEvent(new CustomEvent('icash-public-checkout-change',{detail:active}));
  return()=>{window.dispatchEvent(new CustomEvent('icash-public-checkout-change',{detail:false}));};
 },[checkingAccount,preview]);
 function openWorkspace(){allowWebinarNavigation();setSignInOpen(false);if(onSignedIn)onSignedIn();else window.location.assign(webinarSite.workspacePath);}
 return <div className="wb-express-page wb-plan-home icash-launch-home" data-public-checkout={!checkingAccount&&!preview?'true':undefined}>
  {preview&&<nav className="wb-preview-tools" aria-label="Owner preview"><span>After webinar · Didn’t buy · Payments disabled</span><a href={previewBackHref}>Back to webinar</a></nav>}
  <header className="wb-express-header">
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><IcashMark/></a>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
  </header>
  <main className="wb-express">
   {checkingAccount?<section className="wb-express-status" aria-label="Account status">
    <h1>{accountError?'Let’s try that again.':'One moment…'}</h1>
    {accountError?<><p role="alert">We couldn’t load your account.</p><button type="button" className="wb-express-retry" onClick={onRetry}>Try again</button><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></>:<p role="status">Getting everything ready for you.</p>}
   </section>:<div className="wb-plan-layout">
    <section className="launch-product-preview" aria-labelledby="icash-features-title">
     <h1 className="sr-only" id="icash-features-title">iCash X — your AI wholesaling workspace</h1>
     <div className="wb-product-stage"><Image src="/webinar-offer-icash-x.png" alt="iCash X product overview showing property research, conversations and deal progress in one workspace" width={1672} height={941} sizes="(max-width: 760px) calc(100vw - 32px), 680px" preload/></div>
     <div className="wb-brand-capabilities" aria-label="AI wholesale automation">
      <article><span className="wb-capability-icon"><House size={24} strokeWidth={1.6} aria-hidden="true"/></span><h3>Research properties.</h3><p>Property data and cash offer estimates.</p></article>
      <article><span className="wb-capability-icon"><MessageCircle size={24} strokeWidth={1.6} aria-hidden="true"/></span><h3>Follow up.</h3><p>Seller calls, texts and conversations.</p></article>
      <article><span className="wb-capability-icon"><FileCheck2 size={24} strokeWidth={1.6} aria-hidden="true"/></span><h3>Move deals forward.</h3><p>Contract tools and buyer matching.</p></article>
     </div>
    </section>
    <div className="wb-express-card wb-plan-card" id="your-plan" tabIndex={-1}>
     <MembershipCheckout preview={preview} redirectToVip embedded autoOpen webinarSessionId={webinarSessionId} presentation="plan" onSignedIn={openWorkspace}/>
     <a className="wb-text" href={webinarSite.supportPath}>Have a question? We’re here.</a>
    </div>
   </div>}
  </main>
  {!checkingAccount&&<footer className="wb-plan-footer"><span>iCash X · Wholesale real estate, automated.</span><a href="/costs-and-disclosures">Costs &amp; terms</a></footer>}
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
