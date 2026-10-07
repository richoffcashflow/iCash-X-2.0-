'use client';
import {useState} from 'react';
import Image from 'next/image';
import {ArrowRight,Sparkles} from 'lucide-react';
import {AccountAccess} from '@/components/account-access';
import {FundingDialog} from '@/components/funding-dialog';
import {MembershipCheckout} from '@/components/membership-checkout';
import {PlanWorkspacePreview} from '@/components/plan-workspace-preview';
import {webinarSite} from '@/lib/webinar-site';
import '@/app/webinar/webinar.css';
import '@/app/plan-homepage.css';

type Props={checkingAccount?:boolean;accountError?:boolean;signInReady?:boolean;onRetry?:()=>void;onSignedIn?:()=>void};

export function WebinarExpressCheckout({checkingAccount=false,accountError=false,signInReady=true,onRetry,onSignedIn}:Props={}){
 const [signInOpen,setSignInOpen]=useState(false);
 const [checkoutEngaged,setCheckoutEngaged]=useState(false);
 function openWorkspace(){setSignInOpen(false);if(onSignedIn)onSignedIn();else window.location.assign(webinarSite.workspacePath);}
 return <div className="wb-express-page wb-plan-home">
  <header className="wb-express-header">
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={106} height={60} priority/></a>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
  </header>
  <main className="wb-express">
   {checkingAccount?<section className="wb-express-status" aria-label="Account status">
    <h1>{accountError?'Let’s try that again.':'One moment…'}</h1>
    {accountError?<><p role="alert">We couldn’t load your account.</p><button type="button" className="wb-express-retry" onClick={onRetry}>Try again</button><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></>:<p role="status">Getting everything ready for you.</p>}
   </section>:<div className="wb-plan-layout" data-engaged={checkoutEngaged}>
    <div className="wb-plan-story">
     <section className="wb-plan-intro">
      <span className="wb-plan-kicker"><Sparkles size={12} aria-hidden="true"/>YOUR REAL ESTATE ADVANTAGE</span>
      <h1>Big ambitions.<br/><span>Meet your<br className="wb-plan-title-break"/> AI bot.</span></h1>
      <p>Research properties. Talk to sellers. Move deals forward. Your next chapter starts with a smarter workspace.</p>
      <a className="wb-plan-jump" href="#your-plan">Make your next move<ArrowRight size={16} aria-hidden="true"/></a>
     </section>
     <PlanWorkspacePreview/>
    </div>
    <div className="wb-express-card wb-plan-card" id="your-plan" tabIndex={-1}>
     <MembershipCheckout embedded presentation="plan" onEngaged={()=>setCheckoutEngaged(true)} onSignedIn={openWorkspace}/>
     <a className="wb-text" href={webinarSite.supportPath}>Have a question? We’re here.</a>
    </div>
    <div className="wb-plan-onboarding" aria-label="Getting started"><span><b>01</b>Get access</span><ArrowRight size={14} aria-hidden="true"/><span><b>02</b>Name your bot</span><ArrowRight size={14} aria-hidden="true"/><span><b>03</b>Make it yours</span></div>
   </div>}
  </main>
  {!checkingAccount&&<footer className="wb-plan-footer"><span>iCash X · Built for your next move.</span><a href="/costs-and-disclosures">Costs &amp; terms</a></footer>}
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
