'use client';
import {useEffect,useState} from 'react';
import {IcashMark} from '@/components/icash-mark';
import {AccountAccess} from '@/components/account-access';
import {FundingDialog} from '@/components/funding-dialog';
import {MembershipCheckout} from '@/components/membership-checkout';
import {PlanWorkspacePreview} from '@/components/plan-workspace-preview';
import {ArrowDown,ArrowUpRight,BookOpen,Building2,ChevronDown,FileSignature,Phone} from 'lucide-react';
import {webinarSite} from '@/lib/webinar-site';
import {allowWebinarNavigation} from '@/lib/webinar-exit-reminder';
import '@/app/webinar/webinar.css';
import '@/app/plan-homepage.css';
import '@/app/icash-brand.css';
import '@/app/launch-homepage.css';
import '@/app/homepage-features.css';

type Props={preview?:boolean;previewBackHref?:string;showFeatures?:boolean;checkingAccount?:boolean;accountError?:boolean;signInReady?:boolean;onRetry?:()=>void;onSignedIn?:()=>void};

export function WebinarExpressCheckout({preview=false,previewBackHref='/webinar-studio',showFeatures=false,checkingAccount=false,accountError=false,signInReady=true,onRetry,onSignedIn}:Props={}){
 const [webinarSessionId,setWebinarSessionId]=useState<string>();
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('webinar_session');if(id&&/^[0-9a-f-]{36}$/i.test(id))setWebinarSessionId(id);},[]);
 const [signInOpen,setSignInOpen]=useState(false);
 const [purchased,setPurchased]=useState(false);
 useEffect(()=>{
  const active=!checkingAccount&&!preview;
  window.dispatchEvent(new CustomEvent('icash-public-checkout-change',{detail:active}));
  return()=>{window.dispatchEvent(new CustomEvent('icash-public-checkout-change',{detail:false}));};
 },[checkingAccount,preview]);
 function openWorkspace(){allowWebinarNavigation();setSignInOpen(false);if(onSignedIn)onSignedIn();else window.location.assign(webinarSite.workspacePath);}
 return <div className={'wb-express-page wb-plan-home icash-launch-home'+(showFeatures&&!checkingAccount?' icash-homepage-features':'')} data-public-checkout={!checkingAccount&&!preview?'true':undefined}>
  {preview&&<nav className="wb-preview-tools" aria-label="Owner preview"><span>After webinar · Didn’t buy · Payments disabled</span><a href={previewBackHref}>Back to webinar</a></nav>}
  <header className="wb-express-header">
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><IcashMark/>{showFeatures&&!checkingAccount&&<span className="wb-home-wordmark">iCash X<span>2.0</span></span>}</a>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
  </header>
  <main className="wb-express">
   {checkingAccount?<section className="wb-express-status" aria-label="Account status">
    <h1>{accountError?'Let’s try that again.':'One moment…'}</h1>
    {accountError?<><p role="alert">We couldn’t load your account.</p><button type="button" className="wb-express-retry" onClick={onRetry}>Try again</button><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></>:<p role="status">Getting everything ready for you.</p>}
   </section>:<div className="wb-plan-layout">
    {showFeatures&&!purchased?<section className="wb-home-overview" aria-label="Standard plan features">
     <div className="wb-home-hero">
      <div className="wb-home-copy">
       <p className="wb-home-eyebrow">STANDARD PLAN <span aria-hidden="true">/</span> SOFTWARE + TRAINING</p>
       <h1>Your AI<br/>wholesaling <span>bot.</span></h1>
       <p className="wb-home-description">Research properties. Follow up with sellers. Move deals forward. All in one workspace.</p>
       <a className="wb-home-checkout-link" href="#your-plan">Go to checkout <ArrowDown size={17} aria-hidden="true"/></a>
       <p className="wb-home-access">Already a member? Sign in above.</p>
      </div>
      <figure className="wb-home-artwork">
       <div className="wb-home-artwork-label"><span>REAL ESTATE. REIMAGINED.</span><ArrowUpRight size={17} aria-hidden="true"/></div>
       <img src="/icash-x-connected-homes.webp" srcSet="/icash-x-connected-homes-mobile.webp 768w, /icash-x-connected-homes.webp 1536w" sizes="(max-width:760px) calc(100vw - 40px), (max-width:1200px) 50vw, 600px" width={1536} height={1024} alt="Architectural illustration of a modern home connected to smaller homes on silver platforms" loading="eager" fetchPriority="high" decoding="async"/>
       <figcaption><span className="wb-home-artwork-mark" aria-hidden="true">X</span><span>One workspace.<br/><strong>Your next move.</strong></span><span className="wb-home-artwork-index" aria-hidden="true">iCash X / 2.0</span></figcaption>
      </figure>
     </div>
     <ul className="wb-home-features" aria-label="Included with Standard">
      <li><Phone size={20} aria-hidden="true"/><div><h2>AI seller follow-up</h2><p>Calls, texts &amp; saved conversations.</p></div></li>
      <li><Building2 size={20} aria-hidden="true"/><div><h2>Property research</h2><p>Comparable sales &amp; cash offer estimates.</p></div></li>
      <li><FileSignature size={20} aria-hidden="true"/><div><h2>Contracts &amp; buyers</h2><p>E-signatures, buyer matching &amp; outreach.</p></div></li>
      <li><BookOpen size={20} aria-hidden="true"/><div><h2>Training included</h2><p>Your course &amp; practice workspace.</p></div></li>
     </ul>
     <details className="wb-home-preview-panel">
      <summary><span><strong>See your workspace in action</strong><span>Explore research, conversations &amp; deal tools.</span></span><ChevronDown size={20} aria-hidden="true"/></summary>
      <div className="wb-home-preview-content"><PlanWorkspacePreview/></div>
     </details>
    </section>:!purchased?<section className="wb-plan-intro">
     <h1>Your AI wholesaling bot.</h1>
     <p>Property research, seller calls, texts and contracts—all in one workspace.</p>
    </section>:null}
    <div className="wb-express-card wb-plan-card" id="your-plan" role="region" aria-label="Secure checkout" tabIndex={0}>
     <MembershipCheckout preview={preview} redirectToVip embedded autoOpen webinarSessionId={webinarSessionId} presentation="plan" onSignedIn={openWorkspace} onPurchased={showFeatures?()=>setPurchased(true):undefined}/>
    </div>
   </div>}
  </main>
  {!checkingAccount&&<footer className="wb-plan-footer"><a href={webinarSite.supportPath}>Need help?</a><a href="/costs-and-disclosures">Costs &amp; terms</a></footer>}
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
