'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import {ArrowRight,House,MessageCircle,FileCheck2,Play} from 'lucide-react';
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
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={106} height={60} priority/></a>
   <nav className="launch-nav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#ai-workspace">AI workspace</a><a href="#your-plan">Pricing</a></nav>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
   <a className="launch-header-start" href="#your-plan">Get started</a>
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
      <p>Automate property research, seller calls, texts and follow-up. Keep your wholesale business moving from one workspace.</p>
      <div className="launch-hero-actions"><a className="wb-plan-jump" href="#your-plan">Get my AI bot<ArrowRight size={20} aria-hidden="true"/></a><a className="launch-explore" href="#ai-workspace"><Play size={17} fill="currentColor" aria-hidden="true"/>Explore the workspace</a></div>
      <small className="launch-price-note">$50/month. Work credits separate.</small>
     </section>
     <div className="wb-product-stage"><Image src="/icash-x-launch-hero.webp" alt="iCash X product concept with a laptop, AI phone assistant and house model overlooking the city" width={2056} height={765} sizes="(max-width: 1400px) 100vw, 1320px" preload/></div>
     <section className="launch-features" id="how-it-works" aria-labelledby="launch-features-title"><span className="launch-eyebrow">HOW IT WORKS</span><h2 id="launch-features-title">Let your bot do the groundwork.</h2>
     <div className="wb-brand-capabilities" aria-label="AI wholesale automation">
      <article><span className="wb-capability-icon"><House size={36} strokeWidth={1.5} aria-hidden="true"/></span><h3>Research the property.</h3><p>Bring property data, repair estimates and cash offer analysis into your wholesale pipeline.</p></article>
      <article><span className="wb-capability-icon"><MessageCircle size={36} strokeWidth={1.5} aria-hidden="true"/></span><h3>Talk to the seller.</h3><p>Let your AI bot handle seller calls, texts and follow-up. Every conversation stays connected to the property.</p></article>
      <article><span className="wb-capability-icon"><FileCheck2 size={36} strokeWidth={1.5} aria-hidden="true"/></span><h3>Move the deal forward.</h3><p>Keep offers, contract tools and next steps together. See what your bot is doing and step in when needed.</p></article>
     </div>
     </section>
     <section className="launch-workspace-preview" id="ai-workspace" aria-labelledby="launch-workspace-title"><div className="launch-section-heading"><div><span className="launch-eyebrow">YOUR AI WORKSPACE</span><h2 id="launch-workspace-title">One bot. Your whole pipeline.</h2></div><p>See your properties, conversations and deal progress in one place. Stay in control while your AI handles the work.</p></div><Image src="/icash-x-workspace-preview.webp" alt="Workspace design preview with sample properties, bot controls, credits, seller conversations and offer estimates" width={1435} height={1096} sizes="(max-width: 1400px) 100vw, 1280px"/><p className="launch-preview-caption">Workspace preview · Sample data</p></section>
     <section className="launch-plan-intro" aria-labelledby="launch-plan-title"><span className="launch-eyebrow">PUT YOUR BOT TO WORK</span><h2 id="launch-plan-title">Your next move starts here.</h2><p>Get your AI bot, make it yours, and add work credits when you’re ready to start.</p></section>
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
