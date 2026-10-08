'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import {ArrowRight,House,MessageCircle,FileCheck2} from 'lucide-react';
import {AccountAccess} from '@/components/account-access';
import {FundingDialog} from '@/components/funding-dialog';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
import '@/app/webinar/webinar.css';
import '@/app/plan-homepage.css';
import '@/app/icash-brand.css';

type Props={checkingAccount?:boolean;accountError?:boolean;signInReady?:boolean;onRetry?:()=>void;onSignedIn?:()=>void};

export function WebinarExpressCheckout({checkingAccount=false,accountError=false,signInReady=true,onRetry,onSignedIn}:Props={}){
 const [webinarSessionId,setWebinarSessionId]=useState<string>();
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('webinar_session');if(id&&/^[0-9a-f-]{36}$/i.test(id))setWebinarSessionId(id);},[]);
 const [signInOpen,setSignInOpen]=useState(false);
 const [checkoutEngaged,setCheckoutEngaged]=useState(false);
 function openWorkspace(){setSignInOpen(false);if(onSignedIn)onSignedIn();else window.location.assign(webinarSite.workspacePath);}
 return <div className="wb-express-page wb-plan-home">
  <header className="wb-express-header">
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={106} height={60} priority/></a>
   <span className="wb-brand-line">WHOLESALE. AUTOMATED.</span>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
  </header>
  <main className="wb-express">
   {checkingAccount?<section className="wb-express-status" aria-label="Account status">
    <h1>{accountError?'Let’s try that again.':'One moment…'}</h1>
    {accountError?<><p role="alert">We couldn’t load your account.</p><button type="button" className="wb-express-retry" onClick={onRetry}>Try again</button><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></>:<p role="status">Getting everything ready for you.</p>}
   </section>:<div className="wb-plan-layout" data-engaged={checkoutEngaged}>
    <div className="wb-plan-story">
     <section className="wb-plan-intro">
      <span className="wb-plan-kicker">YOUR AI WHOLESALE BOT</span>
      <h1>WHOLESALE.<br/><span>AUTOMATED.</span></h1>
      <p>Put your wholesale business on autopilot. Your AI bot researches properties, reaches sellers and keeps following up—so you can focus on your next deal.</p>
      <a className="wb-plan-jump" href="#your-plan">GET MY AI BOT<ArrowRight size={18} aria-hidden="true"/></a>
     </section>
     <div className="wb-product-stage"><Image src="/icash-x-white-studio.webp" alt="iCash X on a silver laptop and phone beside a modern house model in a white studio" width={1536} height={1024} sizes="(max-width: 780px) 100vw, (max-width: 1200px) 58vw, 760px" priority/></div>
     <div className="wb-brand-capabilities" aria-label="AI wholesale automation">
      <article><span className="wb-capability-icon"><House size={19} aria-hidden="true"/></span><h3>Find the deal.</h3><p>Property research<br/>and offer estimates.</p></article>
      <article><span className="wb-capability-icon"><MessageCircle size={19} aria-hidden="true"/></span><h3>Start the talk.</h3><p>Seller calls, texts<br/>and follow-ups.</p></article>
      <article><span className="wb-capability-icon"><FileCheck2 size={19} aria-hidden="true"/></span><h3>Make the move.</h3><p>Offer preparation<br/>and contract tools.</p></article>
     </div>
    </div>
    <div className="wb-express-card wb-plan-card" id="your-plan" tabIndex={-1}>
     <MembershipCheckout embedded webinarSessionId={webinarSessionId} presentation="plan" onEngaged={()=>setCheckoutEngaged(true)} onSignedIn={openWorkspace}/>
     <a className="wb-text" href={webinarSite.supportPath}>Have a question? We’re here.</a>
    </div>
    <div className="wb-plan-onboarding" aria-label="Getting started"><span><b>01</b>Get your AI bot</span><ArrowRight size={14} aria-hidden="true"/><span><b>02</b>Make it yours</span><ArrowRight size={14} aria-hidden="true"/><span><b>03</b>Put it to work</span></div>
   </div>}
  </main>
  {!checkingAccount&&<footer className="wb-plan-footer"><span>iCash X · Wholesale real estate, automated.</span><a href="/costs-and-disclosures">Costs &amp; terms</a></footer>}
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
