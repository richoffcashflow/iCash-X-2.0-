'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import {ArrowRight,House,MessageCircle,FileCheck2} from 'lucide-react';
import {IcashMark} from '@/components/icash-mark';
import {AccountAccess} from '@/components/account-access';
import {FundingDialog} from '@/components/funding-dialog';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
import '@/app/webinar/webinar.css';
import '@/app/plan-homepage.css';
import '@/app/icash-brand.css';
import '@/app/launch-homepage.css';

type Props={checkingAccount?:boolean;accountError?:boolean;signInReady?:boolean;onRetry?:()=>void;onSignedIn?:()=>void};

export function WebinarExpressCheckout({checkingAccount=false,accountError=false,signInReady=true,onRetry,onSignedIn}:Props={}){
 const [webinarSessionId,setWebinarSessionId]=useState<string>();
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('webinar_session');if(id&&/^[0-9a-f-]{36}$/i.test(id))setWebinarSessionId(id);},[]);
 const [signInOpen,setSignInOpen]=useState(false);
 const [checkoutEngaged,setCheckoutEngaged]=useState(false);
 function openWorkspace(){setSignInOpen(false);if(onSignedIn)onSignedIn();else window.location.assign(webinarSite.workspacePath);}
 return <div className="wb-express-page wb-plan-home icash-launch-home">
  <header className="wb-express-header">
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><IcashMark/></a>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
  </header>
  <main className="wb-express">
   {checkingAccount?<section className="wb-express-status" aria-label="Account status">
    <h1>{accountError?'Let’s try that again.':'One moment…'}</h1>
    {accountError?<><p role="alert">We couldn’t load your account.</p><button type="button" className="wb-express-retry" onClick={onRetry}>Try again</button><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></>:<p role="status">Getting everything ready for you.</p>}
   </section>:<div className="wb-plan-layout" data-engaged={checkoutEngaged}>
    <div className="wb-plan-story">
     <section className="wb-plan-intro">
      <span className="wb-plan-kicker">WHOLESALE REAL ESTATE. AUTOMATED.</span>
      <h1>Your AI bot for<br/><span>wholesale real estate.</span></h1>
      <p>Property research, seller calls, texts and follow-up. Get your AI bot and manage it all from one workspace.</p>
     </section>
    </div>
    <div className="wb-express-card wb-plan-card" id="your-plan" tabIndex={-1}>
     <MembershipCheckout embedded webinarSessionId={webinarSessionId} presentation="plan" onEngaged={()=>setCheckoutEngaged(true)} onSignedIn={openWorkspace}/>
     <a className="wb-text" href={webinarSite.supportPath}>Have a question? We’re here.</a>
    </div>
    <div className="launch-product-preview">
     <div className="wb-product-stage"><Image src="/icash-x-launch-hero.webp" alt="iCash X product concept with a laptop, AI phone assistant and house model overlooking the city" width={2056} height={765} sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1200px) 52vw, 630px"/></div>
     <div className="wb-brand-capabilities" aria-label="AI wholesale automation">
      <article><span className="wb-capability-icon"><House size={24} strokeWidth={1.6} aria-hidden="true"/></span><h3>Research properties.</h3><p>Property data and cash offer estimates.</p></article>
      <article><span className="wb-capability-icon"><MessageCircle size={24} strokeWidth={1.6} aria-hidden="true"/></span><h3>Follow up.</h3><p>Seller calls, texts and conversations.</p></article>
      <article><span className="wb-capability-icon"><FileCheck2 size={24} strokeWidth={1.6} aria-hidden="true"/></span><h3>Move deals forward.</h3><p>Contract tools and buyer matching.</p></article>
     </div>
    </div>
    <div className="wb-plan-onboarding" aria-label="Getting started"><span><b>01</b>Get access</span><ArrowRight size={14} aria-hidden="true"/><span><b>02</b>Name your bot</span><ArrowRight size={14} aria-hidden="true"/><span><b>03</b>Add work credits</span></div>
   </div>}
  </main>
  {!checkingAccount&&<footer className="wb-plan-footer"><span>iCash X · Wholesale real estate, automated.</span><a href="/costs-and-disclosures">Costs &amp; terms</a></footer>}
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
