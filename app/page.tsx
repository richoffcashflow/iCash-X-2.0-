"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, Plus } from "lucide-react";
import { previewCreditPacks } from "@/config/credit-packs";
import { readDemoProgress } from "@/lib/demo-progress";
import { FundingCheckout } from "@/components/funding-checkout";
import { AccountAccess } from "@/components/account-access";
import { DemoRunner } from "@/components/demo-runner";

export default function Home() {
  type Account={signedIn:boolean;signInReady?:boolean;mode?:"test"|"live";email?:string;phone?:string;balanceCents?:number;assistantName?:string;paused?:boolean;billingReview?:boolean};
  const [account,setAccount]=useState<Account|null>(null);
  const [accountError,setAccountError]=useState(false);
  const [signInOpen,setSignInOpen]=useState(false);
  async function refreshAccount(){try{const r=await fetch("/api/account",{cache:"no-store"});if(!r.ok)throw new Error();setAccount(await r.json());setAccountError(false);setSignInOpen(false);}catch{setAccountError(true);}}
  async function signOut(){const r=await fetch("/api/auth/logout",{method:"POST"});if(r.ok){setAccount({signedIn:false});setFundingOpen(false);}else setAccountError(true);}
  useEffect(()=>{void refreshAccount();},[]);
  const [started, setStarted] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  useEffect(()=>{if(readDemoProgress())setStarted(true);if(new URLSearchParams(window.location.search).has("payment"))setFundingOpen(true);},[]);
  function start() { setStarted(true); }
  function openFunding() { setFundingOpen(true); window.requestAnimationFrame(()=>document.getElementById("inline-funding")?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"center"})); }

  return <div className="console-shell">
    <header className="console-header"><div><Image src="/icash-x-logo.png" alt="iCash X" width={111} height={62} priority /><span>{account?.signedIn?(account.mode==="test"?"TEST ACCOUNT":"YOUR ACCOUNT"):"FREE SAMPLE"}</span></div><button className="header-access" onClick={()=>account?.signedIn?void signOut():setSignInOpen(v=>!v)}>{account?.signedIn?"Sign out":"Sign in"}</button></header>
    <main className="console-main">
      <h1 className="sr-only">iCash X AI wholesaling workspace</h1>
      {signInOpen&&<section className="balance-panel"><h2>Welcome back</h2><AccountAccess ready={account?.signInReady===true} onSignedIn={()=>void refreshAccount()}/></section>}
      {accountError&&<p role="alert">Could not load your account. <button onClick={()=>void refreshAccount()}>Retry</button></p>}
      <section className="balance-panel" aria-labelledby="balance-label">
        <div className="balance-top"><div><span id="balance-label">Your balance</span><strong>{account?.signedIn?`$${((account.balanceCents??0)/100).toFixed(2)}`:"$0"}<span>{account?.signedIn?(account.mode==="test"?"test balance":"available"):"available"}</span></strong></div><button className={`fund-button ${account?.signedIn?"":"balance-add"}`} aria-expanded={fundingOpen} aria-controls="inline-funding" onClick={()=>setFundingOpen(value=>!value)}>Add {previewCreditPacks[0].label} <Plus size={18}/></button></div>
        <p>Funds your bot’s work. No monthly subscription.</p>
        {fundingOpen && <div className="inline-funding" id="inline-funding"><div><strong>Start with {previewCreditPacks[0].label}</strong><span>One-time payment</span></div><p>You choose a daily spending limit. Your bot stops when the money runs out. A deal is never guaranteed.</p><FundingCheckout onSignedIn={()=>{setFundingOpen(false);void refreshAccount();}}/><small>Real payments are not open yet. Test payments do not pay for real work.</small></div>}
      </section>
      <section className="operation-panel" aria-label="Your AI real estate assistant">
        {(account?.signedIn||started)&&<div className="operation-top"><span className="bot-icon">X</span><div><h2 id="operation-title">{account?.signedIn?account.assistantName:"Your bot"}</h2><span>{account?.signedIn?"Your balance is saved":started ? "Sample activity · fictional people and properties" : "See how your bot works"}</span></div><span className="mode-badge">{account?.signedIn?"PAUSED":"SAMPLE"}</span></div>}
        {account?.signedIn?<div className="operation-empty"><h3>{account.billingReview?"Your payment needs a review":"Your bot is paused."}</h3><p>{account.billingReview?"Your bot is paused while a payment issue is reviewed.":"Real property work is not available yet. Your money is not being spent."}</p><details><summary>Account details</summary><p>{account.email}</p>{account.phone&&<p>{account.phone}</p>}<p>No automatic reloads. No outreach has been sent.</p></details></div>:!account?<div className="operation-empty"><p role="status">{accountError?"Your workspace could not load. Tap Retry above.":"Opening your workspace…"}</p></div>:!started ? <div className="operation-empty"><h2 className="entry-title">Your AI real estate assistant.</h2><p>Finds potential deals, follows up with sellers, and helps move deals toward closing.</p><button className="demo-button first-action" onClick={start}>See how it works — free <ArrowRight size={18}/></button><small>No typing. No sign-up. No card.</small><p className="sample-label">Free sample. No real calls or deals.</p></div> : <DemoRunner onFund={openFunding} />}
      </section>
    </main>
    <footer className="console-footer"><details className="inline-disclosures"><summary>How it works & help</summary><div><p><strong>New to wholesaling?</strong> It means securing a property agreement and arranging a sale or assignment to another buyer. A signed contract is a step toward closing, not a payment.</p><p><strong>Need help?</strong> Open the property card to see the conversation and next step. Live human support is not connected in this preview.</p><p><strong>Your balance:</strong> Add money once and use it for bot services as needed. No monthly subscription. Prices for each type of work will be shown before real payments open. Our prices include a margin above our service costs.</p><p><strong>Your control:</strong> Approve a daily limit and pause at any time. Auto-reload requires separate opt-in. Free use stops at its limit and does not silently become paid use.</p><p><strong>Results:</strong> No property, contract, buyer, closing, or income is guaranteed. Sample people and outcomes are fictional. AI estimates and documents need appropriate verification.</p><p><strong>Live work:</strong> Contact permissions, local rules, owner authority, and approved contract terms must pass before work is dispatched. Being a property buyer does not by itself exempt AI calls from applicable rules.</p><p>You can try the free sample now. Real payments and bot work are not open yet. Email sign-in is being connected.</p></div></details></footer>
  </div>;
}

