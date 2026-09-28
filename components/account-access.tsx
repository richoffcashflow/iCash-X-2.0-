"use client";
import { useState } from "react";
export function AccountAccess({initialEmail="",onSignedIn,ready=true}:{initialEmail?:string;onSignedIn:()=>void;ready?:boolean}){
 const [email,setEmail]=useState(initialEmail);const [code,setCode]=useState("");const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");try{
 const r=await fetch(sent?"/api/auth/verify":"/api/auth/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,code})});const d=await r.json();if(!r.ok)throw new Error(d.error);
 if(sent)onSignedIn();else{setSent(true);setMessage(d.message);}
 }catch(e){setMessage(e instanceof Error?e.message:"Please try again.");}finally{setBusy(false);}}
 if(!ready)return <p role="status">Email sign-in is being connected. Your test payments remain saved. You can still try the free demonstration.</p>;
 return <form className="account-access" onSubmit={submit}><p>{sent?"Check your inbox and Junk/Spam for your code.":"Use the email from your payment. No password needed."}</p><label>Email<input type="email" autoComplete="email" required value={email} disabled={sent||busy} onChange={e=>setEmail(e.target.value)}/></label>{sent&&<p className="sign-in-help">Look for <strong>“Your iCash X sign-in code”</strong> from <strong>signin@geticashx.com</strong>. Use the newest code. Already paid? Your payment is saved—do not pay again.</p>}{sent&&<label>Email code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required maxLength={10} value={code} onChange={e=>setCode(e.target.value)}/></label>}<button className="fund-button full" disabled={busy}>{busy?"One moment…":sent?"Sign in":"Email me a code"}</button>{sent&&<button type="button" className="demo-button" disabled={busy} onClick={()=>{setSent(false);setCode("");setMessage("");}}>Use another email or resend</button>}{message&&<p role="status">{message}</p>}</form>;
}
