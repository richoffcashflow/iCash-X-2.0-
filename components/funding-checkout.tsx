"use client";
import { useEffect,useState } from "react";
import { TestCheckout } from "@/components/test-checkout";
import { AccountAccess } from "@/components/account-access";
type Funding={mode:"test"|"live"|null;enabled:boolean;priceCents?:number;paidCents?:number;needsClaim?:boolean;email?:string;error?:string};
export function FundingCheckout({onSignedIn}:{onSignedIn:()=>void}){
 const [status,setStatus]=useState<Funding|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function refresh(){try{const r=await fetch("/api/funding/status",{cache:"no-store"});const d=await r.json();setStatus(d);}catch{setError("Could not check your payment. Please retry.");}}
 useEffect(()=>{void refresh();},[]);
 async function checkout(){setBusy(true);setError("");try{const r=await fetch("/api/funding/checkout",{method:"POST"});const d=await r.json();if(!r.ok)throw new Error(d.error);const url=new URL(d.url);if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw new Error("Could not open secure checkout.");window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:"Please retry.");setBusy(false);}}
 if(!status)return <p role="status">Checking your balance…{error&&<button onClick={()=>void refresh()}>Retry</button>}</p>;
 if(!status.enabled&&!status.paidCents)return <TestCheckout/>;
 return <div>{status.mode==="test"&&<p><strong>Test mode</strong> · No real money or live work.</p>}{!!status.paidCents&&<p role="status">Payment confirmed: ${(status.paidCents/100).toFixed(2)} {status.mode==="test"?"test credits":"in credits"}.</p>}{status.needsClaim?<><h3>Keep your balance</h3><p>Verify your email once. We’ll remember this browser.</p><AccountAccess initialEmail={status.email??""} onSignedIn={onSignedIn}/></>:<button className="fund-button full" disabled={busy||!status.enabled} onClick={checkout}>{busy?"Opening Stripe…":`${status.mode==="test"?"Test funding":"Add"} $${((status.priceCents??0)/100).toFixed(0)}`}</button>}<p className="funding-note">Your phone number is collected at checkout for account and deal coordination. This does not opt you into marketing texts.</p>{error&&<p role="alert">{error}</p>}<button className="demo-button" onClick={()=>void refresh()}>Check payment</button></div>;
}
