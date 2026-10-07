'use client';
import {useState} from 'react';
import Image from 'next/image';
import {AccountAccess} from '@/components/account-access';
import {FundingDialog} from '@/components/funding-dialog';
import {MembershipCheckout} from '@/components/membership-checkout';
import {webinarSite} from '@/lib/webinar-site';
import '@/app/webinar/webinar.css';

type Props={checkingAccount?:boolean;accountError?:boolean;signInReady?:boolean;onRetry?:()=>void;onSignedIn?:()=>void};

export function WebinarExpressCheckout({checkingAccount=false,accountError=false,signInReady=true,onRetry,onSignedIn}:Props={}){
 const [signInOpen,setSignInOpen]=useState(false);
 function openWorkspace(){setSignInOpen(false);if(onSignedIn)onSignedIn();else window.location.assign(webinarSite.workspacePath);}
 return <div className="wb-express-page">
  <header className="wb-express-header">
   <a className="wb-express-brand" href="/" aria-label="iCash X home"><Image src="/icash-x-logo.png" alt="iCash X" width={106} height={60} priority/></a>
   <button type="button" className="wb-express-sign-in" aria-haspopup="dialog" onClick={()=>setSignInOpen(true)}>Sign in</button>
  </header>
  <main className="wb-express">
   {checkingAccount?<section className="wb-express-status" aria-label="Account status">
    <h1>{accountError?'Let’s try that again.':'One moment…'}</h1>
    {accountError?<><p role="alert">We couldn’t load your account.</p><button type="button" className="wb-express-retry" onClick={onRetry}>Try again</button><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></>:<p role="status">Getting everything ready for you.</p>}
   </section>:<div className="wb-express-card"><span className="wb-eyebrow">YOUR NEXT STEP</span><h1>Set up your AI bot.</h1><MembershipCheckout embedded onSignedIn={openWorkspace}/><a className="wb-text" href={webinarSite.supportPath}>Need help?</a></div>}
  </main>
  {signInOpen&&<FundingDialog title="Welcome back" onClose={()=>setSignInOpen(false)}><AccountAccess ready={signInReady} onSignedIn={openWorkspace}/></FundingDialog>}
 </div>;
}
