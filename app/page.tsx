"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, Plus, X, House, Phone, Users } from "lucide-react";

import { FundingCheckout } from "@/components/funding-checkout";
import { AccountAccess } from "@/components/account-access";
import { CustomerIdentity } from "@/components/customer-identity";
import type { CustomerIdentity as Identity } from "@/lib/customer-identity";
import {BudgetSummary} from '@/components/budget-summary';
import {LiveWorkspace} from "@/components/live-workspace";

export default function Home() {
  type Account={workReady?:boolean;identity?:Identity|null;signedIn:boolean;signInReady?:boolean;mode?:"test"|"live";email?:string;phone?:string;balanceCents?:number;assistantName?:string;paused?:boolean;billingReview?:boolean};
  const [account,setAccount]=useState<Account|null>(null);
  const [controlBusy,setControlBusy]=useState(false);
  async function toggleBot(){setControlBusy(true);try{const r=await fetch("/api/work/control",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:account?.paused?"resume":"pause"})});if(!r.ok)throw new Error();await refreshAccount();}catch{setAccountError(true);}finally{setControlBusy(false);}}
  const [accountError,setAccountError]=useState(false);
  const [signInOpen,setSignInOpen]=useState(false);
  async function refreshAccount(){try{const r=await fetch("/api/account",{cache:"no-store"});if(!r.ok)throw new Error();setAccount(await r.json());setAccountError(false);setSignInOpen(false);}catch{setAccountError(true);}}
  async function signOut(){const r=await fetch("/api/auth/logout",{method:"POST"});if(r.ok){setAccount({signedIn:false});setFundingOpen(false);}else setAccountError(true);}
  useEffect(()=>{void refreshAccount();},[]);
  const [fundingCode,setFundingCode]=useState("start");
  const [fundingOpen, setFundingOpen] = useState(false);
  useEffect(()=>{if(new URLSearchParams(window.location.search).has("payment"))setFundingOpen(true);},[]);
  function closeFunding(){setFundingOpen(false);}
  function toggleSignIn(){setSignInOpen(value=>!value);setFundingOpen(false);}
  function closeSignIn(){setSignInOpen(false);window.requestAnimationFrame(()=>document.getElementById("balance-sign-in")?.focus());}
  function openFunding(code="start") { setFundingCode(code);setFundingOpen(true); window.requestAnimationFrame(()=>document.getElementById("inline-funding")?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"center"})); }

  return <div className={`console-shell clean-funnel ${account?.signedIn?"is-member":"is-guest"}`}>
    <header className="console-header"><div><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority /><b className="brand-version">2.0</b><span>{account?.signedIn?(account.mode==="test"?"TEST ACCOUNT":"YOUR ACCOUNT"):"YOUR AI BOT"}</span></div>{account?.signedIn?<button className="header-access" onClick={()=>void signOut()}>Sign out</button>:<button id="balance-sign-in" className="header-access" aria-expanded={signInOpen} aria-controls="inline-sign-in" onClick={toggleSignIn}>Sign in</button>}</header>
    <main className="console-main">
      {account?.signedIn&&<h1 className="sr-only">Your iCash X workspace</h1>}
      {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
      {signInOpen&&!account?.signedIn&&<section className="inline-sign-in" id="inline-sign-in" aria-labelledby="sign-in-title" onKeyDown={e=>{if(e.key==="Escape")closeSignIn();}}><div className="sign-in-heading"><h2 id="sign-in-title">Welcome back</h2><button aria-label="Close sign-in" onClick={closeSignIn}><X size={19}/></button></div><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount()}/></section>}
      {account?.signedIn&&<section className="balance-panel" aria-labelledby="balance-label"><div className="balance-heading"><span id="balance-label">Your balance</span></div><div className="balance-top"><strong>${((account.balanceCents??0)/100).toFixed(2)}<span>{account.mode==="test"?"test funds":"available"}</span></strong><button className="fund-button" aria-expanded={fundingOpen} aria-controls="inline-funding" onClick={()=>fundingOpen?closeFunding():openFunding()}>Add funds <Plus size={18}/></button></div></section>}
      <section className="operation-panel" aria-label="Your AI real estate bot">
        {account?.signedIn&&<div className="operation-top"><span className="bot-icon">X</span><div><h2 id="operation-title">{account?.signedIn?account.assistantName:"Your bot"}</h2><span>{account?.signedIn?"Your balance is saved":"Your AI bot"}</span></div><span className="mode-badge">{account?.signedIn?(account.paused?"PAUSED":"SETUP PENDING"):"SAMPLE"}</span></div>}
        {account?.signedIn?<div className="operation-empty"><h3>{account.billingReview?"Your payment needs a review":account.paused?"Your bot is paused.":"Your bot is awaiting live setup."}</h3><p>{account.billingReview?"Your bot is paused while a payment issue is reviewed.":"Live acquisition is still being configured. Your saved work and documents are below."}</p><button className="demo-button" disabled={controlBusy} onClick={()=>void toggleBot()}>{controlBusy?"Saving…":account.paused?"Resume bot":"Pause bot"}</button><BudgetSummary onFund={openFunding}/><LiveWorkspace principal={account.identity?.principal??""}/><details><summary>Account details</summary><p>{account.email}</p>{account.phone&&<p>{account.phone}</p>}<CustomerIdentity identity={account.identity??null} onSaved={()=>void refreshAccount()}/><p>No automatic reloads. No outreach has been sent.</p></details></div>:!account?<div className="entry-loading" role="status">Opening your workspace…</div>:<div className="entry-hero open-entry"><span className="entry-kicker">REAL ESTATE WHOLESALING, MADE EASY</span><h1>Your AI bot for<br/><span>real estate deals.</span></h1><p>Find a house. Talk to the seller. Find a buyer.<br className="desktop-break"/> Your bot helps handle the steps.</p>
          <div className="open-start"><span className="start-symbol" aria-hidden="true">X</span><div><strong>Put your bot to work</strong><span>{account.workReady?"Set it up once. Follow the progress here.":"Live start is being connected"}</span></div><button aria-label="Start my bot" disabled={!account.workReady} onClick={()=>openFunding()}><ArrowRight size={22}/></button></div>
          {!account.workReady&&<p className="open-availability" role="status">Not taking payments or starting outreach yet.</p>}
          <div className="open-capabilities" aria-label="What your bot is being built to handle">
           <details><summary><House size={22} aria-hidden="true"/><span><strong>Find a house</strong><small>Check the price, repairs, and potential.</small></span><span className="capability-more" aria-hidden="true">+</span></summary><p>Property research helps decide which owners are worth contacting. An estimate is a starting point, not a confirmed deal.</p></details>
           <details><summary><Phone size={22} aria-hidden="true"/><span><strong>Talk to the seller</strong><small>Ask about selling. Follow up. Discuss an offer.</small></span><span className="capability-more" aria-hidden="true">+</span></summary><p>Once live outreach is connected, your bot can handle permitted conversations within your budget and offer limits. It asks you when a decision needs your approval.</p></details>
           <details><summary><Users size={22} aria-hidden="true"/><span><strong>Find a buyer</strong><small>Move a signed agreement toward closing.</small></span><span className="capability-more" aria-hidden="true">+</span></summary><p>After a purchase agreement is signed, the next steps are buyer outreach and closing coordination. The title or closing company handles the property transfer and agreed funds.</p></details>
          </div>
          <details className="plain-explainer"><summary>How do I get paid?</summary><p>You agree on a price with a seller, then find a buyer who pays for your right to buy the property. If the deal closes, you may earn an assignment fee. Costs and risks apply. A property lead or signed agreement does not guarantee income.</p></details>
        </div>}



      </section>
      {fundingOpen&&<section className="compact-funding" id="inline-funding" aria-labelledby="funding-title"><div className="funding-heading"><div><h2 id="funding-title">Fund your bot</h2><p>Set a budget. Choose the days. Your bot handles the steps.</p></div><button className="close-funding" aria-label="Close funding" onClick={closeFunding}><X size={20}/></button></div><FundingCheckout key={fundingCode} initialCode={fundingCode} onSignedIn={()=>{closeFunding();void refreshAccount();}}/></section>}
    </main>
    <footer className="console-footer"><details className="inline-disclosures"><summary>How it works & help</summary><div><p><strong>New to wholesaling?</strong> It means securing a property agreement and arranging a sale or assignment to another buyer. A signed contract is a step toward closing, not a payment.</p><p><strong>Need help?</strong> Open the property card to see the conversation and next step. Live human support is not connected in this preview.</p><p><strong>Your balance:</strong> Add money once and use it for bot services as needed. No monthly subscription. Prices for each type of work will be shown before real payments open. Our prices include a margin above our service costs.</p><p><strong>Your control:</strong> Approve a daily limit and pause at any time. Auto-reload requires separate opt-in. Free use stops at its limit and does not silently become paid use.</p><p><strong>Results:</strong> No property, contract, buyer, closing, or income is guaranteed. AI estimates and documents need appropriate verification.</p><p><strong>Live work:</strong> Contact permissions, local rules, owner authority, and approved contract terms must pass before work is dispatched. Being a property buyer does not by itself exempt AI calls from applicable rules.</p><p>Real payments and bot work are not open yet. Use Sign in above to access an existing account.</p></div></details></footer>
  </div>;
}

