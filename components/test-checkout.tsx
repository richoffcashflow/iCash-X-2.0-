"use client";
import { useEffect,useState } from "react";
import { previewCreditPacks } from "@/config/credit-packs";
type Status={mode:string;testCreditCents?:number;setup?:{stripe:boolean;database:boolean;webhook:boolean};error?:string};
export function TestCheckout() {
 const [status,setStatus]=useState<Status>({mode:"loading"});const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function refresh(){try{const r=await fetch("/api/payments/status",{cache:"no-store"});setStatus(await r.json());}catch{setStatus({mode:"error"});}}
 useEffect(()=>{void refresh();},[]);
 async function checkout(){setBusy(true);setError("");try{const r=await fetch("/api/payments/checkout",{method:"POST"});const data=await r.json();if(!r.ok)throw new Error(data.error||"Please try again.");const url=new URL(data.url);if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw new Error("Invalid checkout link");window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:"Please try again.");setBusy(false);}}
 if(status.mode==="test")return <div><p><strong>Stripe test mode</strong> · No real money or live bot credits.</p>{!!status.testCreditCents && <p role="status">Verified test credits: ${(status.testCreditCents/100).toFixed(2)}</p>}<button className="fund-button full" disabled={busy} onClick={checkout}>{busy?"Opening Stripe…":`Test ${previewCreditPacks[0].label} checkout`}</button>{error&&<p role="alert">{error}</p>}<button className="demo-button" style={{marginTop:12}} onClick={()=>void refresh()}>Check test payment</button></div>;
 if(status.mode==="setup")return <p>Preview checkout setup: {status.setup?.stripe?"Stripe key configured.":"Stripe test secret key missing."} {status.setup?.database?"Database configured.":"Supabase server credentials needed."}</p>;
 return <><button className="fund-button full" disabled>{status.mode==="loading"?"Checking checkout…":"Payments open soon"}</button>{status.mode==="error"&&<p role="alert">Could not check test payments. Refresh to try again.</p>}</>;
}
