'use client';
import {useEffect,useState} from 'react';
import {installWebinarPresence} from '@/lib/webinar-presence';
import {webinarBeacon} from '@/lib/webinar-client';
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
 useEffect(()=>{if(!webinarSessionId||preview||checkingAccount)return;return installWebinarPresence(presence=>webinarBeacon('/api/webinar/presence',{sessionId:webinarSessionId,...presence}),document,window,'checkout');},[webinarSessionId,preview,checkingAccount]);
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
    <section className="wb-plan-intro">
     <h1>Your AI wholesaling bot.</h1>
     <p>Property research, seller calls, texts and contracts—all in one workspace.</p>
    </section>
    <div className="wb-express-card wb-plan-card" id="your-plan" role="region" aria-label="Secure checkout" tabIndex={0}>
     <MembershipCheckout preview={preview} redirectToVip embedded autoOpen webinarSessionId={webinarSessionId} presentation="plan" onSignedIn={openWorkspace}/>
    </div>
   </div>}
  </main>
  {!checkingAccount&&<footer className="wb-plan-footer"><a href={webinarSite.supportPath}>Need help?</a><a href="/costs-and-disclosures">Costs &amp; terms</a></footer>}
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
