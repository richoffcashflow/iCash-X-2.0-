"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, Plus, X } from "lucide-react";

import { readDemoProgress } from "@/lib/demo-progress";
import { FundingCheckout } from "@/components/funding-checkout";
import { AccountAccess } from "@/components/account-access";
import { CustomerIdentity } from "@/components/customer-identity";
import type { CustomerIdentity as Identity } from "@/lib/customer-identity";
import {BudgetSummary} from '@/components/budget-summary';
import {LiveWorkspace} from "@/components/live-workspace";
import { DemoRunner } from "@/components/demo-runner";

export default function Home() {
  type Account={identity?:Identity|null;signedIn:boolean;signInReady?:boolean;mode?:"test"|"live";email?:string;phone?:string;balanceCents?:number;assistantName?:string;paused?:boolean;billingReview?:boolean};
  const [account,setAccount]=useState<Account|null>(null);
  const [controlBusy,setControlBusy]=useState(false);
  async function toggleBot(){setControlBusy(true);try{const r=await fetch("/api/work/control",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:account?.paused?"resume":"pause"})});if(!r.ok)throw new Error();await refreshAccount();}catch{setAccountError(true);}finally{setControlBusy(false);}}
  const [accountError,setAccountError]=useState(false);
  const [signInOpen,setSignInOpen]=useState(false);
  async function refreshAccount(){try{const r=await fetch("/api/account",{cache:"no-store"});if(!r.ok)throw new Error();setAccount(await r.json());setAccountError(false);setSignInOpen(false);}catch{setAccountError(true);}}
  async function signOut(){const r=await fetch("/api/auth/logout",{method:"POST"});if(r.ok){setAccount({signedIn:false});setFundingOpen(false);}else setAccountError(true);}
  useEffect(()=>{void refreshAccount();},[]);
  const [started, setStarted] = useState(false);
  const [fundingCode,setFundingCode]=useState("start");
  const [fundingOpen, setFundingOpen] = useState(false);
  useEffect(()=>{if(readDemoProgress())setStarted(true);if(new URLSearchParams(window.location.search).has("payment"))setFundingOpen(true);},[]);
  function rememberStep(step:"result"|"funding") { try { localStorage.setItem("icash-entry-v1",JSON.stringify({step,savedAt:Date.now()})); } catch {} }
  function closeFunding(){setFundingOpen(false);rememberStep("result");}
  useEffect(()=>{
    if(account?.signedIn!==false)return;
    try{const saved=JSON.parse(localStorage.getItem("icash-entry-v1")??"null");if(saved&&Number.isFinite(saved.savedAt)&&saved.savedAt<=Date.now()&&Date.now()-saved.savedAt<30*86400000&&["result","funding"].includes(saved.step)){setStarted(true);if(saved.step==="funding")setFundingOpen(true);}}catch{}
  },[account?.signedIn]);
  function start() { setStarted(true);rememberStep("result"); }
  function toggleSignIn(){setSignInOpen(value=>!value);setFundingOpen(false);}
  function closeSignIn(){setSignInOpen(false);window.requestAnimationFrame(()=>document.getElementById("balance-sign-in")?.focus());}
  function openFunding(code="start") { setFundingCode(code);setFundingOpen(true);rememberStep("funding"); window.requestAnimationFrame(()=>document.getElementById("inline-funding")?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"center"})); }

  return <div className={`console-shell clean-funnel ${account?.signedIn?"is-member":"is-guest"}`}>
    <header className="console-header"><div><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority /><b className="brand-version">2.0</b><span>{account?.signedIn?(account.mode==="test"?"TEST ACCOUNT":"YOUR ACCOUNT"):"FREE SAMPLE"}</span></div>{account?.signedIn?<button className="header-access" onClick={()=>void signOut()}>Sign out</button>:<button id="balance-sign-in" className="header-access" aria-expanded={signInOpen} aria-controls="inline-sign-in" onClick={toggleSignIn}>Sign in</button>}</header>
    <main className="console-main">
      {account?.signedIn&&<h1 className="sr-only">Your iCash X workspace</h1>}
      {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
      {signInOpen&&!account?.signedIn&&<section className="inline-sign-in" id="inline-sign-in" aria-labelledby="sign-in-title" onKeyDown={e=>{if(e.key==="Escape")closeSignIn();}}><div className="sign-in-heading"><h2 id="sign-in-title">Welcome back</h2><button aria-label="Close sign-in" onClick={closeSignIn}><X size={19}/></button></div><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount()}/></section>}
      {account?.signedIn&&<section className="balance-panel" aria-labelledby="balance-label"><div className="balance-heading"><span id="balance-label">Your balance</span></div><div className="balance-top"><strong>${((account.balanceCents??0)/100).toFixed(2)}<span>{account.mode==="test"?"test funds":"available"}</span></strong><button className="fund-button" aria-expanded={fundingOpen} aria-controls="inline-funding" onClick={()=>fundingOpen?closeFunding():openFunding()}>Add funds <Plus size={18}/></button></div></section>}
      <section className="operation-panel" aria-label="Your AI real estate bot">
        {account?.signedIn&&<div className="operation-top"><span className="bot-icon">X</span><div><h2 id="operation-title">{account?.signedIn?account.assistantName:"Your bot"}</h2><span>{account?.signedIn?"Your balance is saved":started ? "Sample activity · fictional people and properties" : "See how your bot works"}</span></div><span className="mode-badge">{account?.signedIn?(account.paused?"PAUSED":"SETUP PENDING"):"SAMPLE"}</span></div>}
        {account?.signedIn?<div className="operation-empty"><h3>{account.billingReview?"Your payment needs a review":account.paused?"Your bot is paused.":"Your bot is awaiting live setup."}</h3><p>{account.billingReview?"Your bot is paused while a payment issue is reviewed.":"Live acquisition is still being configured. Your saved work and documents are below."}</p><button className="demo-button" disabled={controlBusy} onClick={()=>void toggleBot()}>{controlBusy?"Saving…":account.paused?"Resume bot":"Pause bot"}</button><BudgetSummary onFund={openFunding}/><LiveWorkspace principal={account.identity?.principal??""}/><details><summary>Account details</summary><p>{account.email}</p>{account.phone&&<p>{account.phone}</p>}<CustomerIdentity identity={account.identity??null} onSaved={()=>void refreshAccount()}/><p>No automatic reloads. No outreach has been sent.</p></details></div>:!account?<div className="entry-loading" role="status">Opening your workspace…</div>:!started ? <div className="entry-hero"><span className="entry-kicker">REAL ESTATE WHOLESALING, MADE EASY</span><h1>Your bot.<br/>Doing the legwork.</h1><p>Find houses. Talk to sellers.<br/>Work toward a deal.</p><button className="fund-button full first-action" onClick={start}>Try my bot free <ArrowRight size={18}/></button><small>No sign-up. No card. Just press start.</small><span className="entry-sample">Interactive sample · Live outreach is not open yet.</span><details className="plain-explainer"><summary>How would I earn money?</summary><p>You agree on a price with a seller, then find a buyer who pays more for your right to buy the property. If the deal closes, you may earn a fee. Costs and risks apply; earnings are not guaranteed.</p></details></div> : <DemoRunner onFund={openFunding} fundingOpen={fundingOpen}/>}

      </section>
      {fundingOpen&&<section className="compact-funding" id="inline-funding" aria-labelledby="funding-title"><div className="funding-heading"><div><h2 id="funding-title">Fund your bot</h2><p>For property checks and seller outreach.</p></div><button className="close-funding" aria-label="Close funding" onClick={closeFunding}><X size={20}/></button></div><FundingCheckout key={fundingCode} initialCode={fundingCode} onSignedIn={()=>{closeFunding();void refreshAccount();}}/></section>}
    </main>
    <footer className="console-footer"><details className="inline-disclosures"><summary>How it works & help</summary><div><p><strong>New to wholesaling?</strong> It means securing a property agreement and arranging a sale or assignment to another buyer. A signed contract is a step toward closing, not a payment.</p><p><strong>Need help?</strong> Open the property card to see the conversation and next step. Live human support is not connected in this preview.</p><p><strong>Your balance:</strong> Add money once and use it for bot services as needed. No monthly subscription. Prices for each type of work will be shown before real payments open. Our prices include a margin above our service costs.</p><p><strong>Your control:</strong> Approve a daily limit and pause at any time. Auto-reload requires separate opt-in. Free use stops at its limit and does not silently become paid use.</p><p><strong>Results:</strong> No property, contract, buyer, closing, or income is guaranteed. Sample people and outcomes are fictional. AI estimates and documents need appropriate verification.</p><p><strong>Live work:</strong> Contact permissions, local rules, owner authority, and approved contract terms must pass before work is dispatched. Being a property buyer does not by itself exempt AI calls from applicable rules.</p><p>You can try the free sample now. Real payments and bot work are not open yet. Use Sign in above to access an existing account.</p></div></details></footer>
  </div>;
}

