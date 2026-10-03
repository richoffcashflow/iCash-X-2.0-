'use client';
import {useEffect,useRef,useState} from 'react';
type Review={available:boolean;reviewKey?:string;customerCapCents?:number;dailyLimitCents?:number;consentVersion?:string};
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export function SpendActivationReview({onSaved,onAvailabilityChange}:{onSaved:()=>void;onAvailabilityChange?:(available:boolean)=>void}){
 const [review,setReview]=useState<Review|null>(null),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[shown,setShown]=useState(false),[loading,setLoading]=useState(false);
 const sequence=useRef(0);
 async function load(){
  const request=++sequence.current;
  setLoading(true);setAccepted(false);setReview(null);setMessage('');onAvailabilityChange?.(false);
  try{
   const r=await fetch('/api/work/activation',{cache:'no-store'});if(!r.ok)throw Error();const q:Review=await r.json();
   if(typeof q?.available!=='boolean'||(q.available&&(!q.reviewKey||!/^[a-f0-9]{32}$/.test(q.reviewKey)||!Number.isSafeInteger(q.customerCapCents)||Number(q.customerCapCents)<=0||Number(q.customerCapCents)>100000||!Number.isSafeInteger(q.dailyLimitCents)||Number(q.dailyLimitCents)<=0||q.consentVersion!=='activation-2026-10-03.1')))throw Error();
   if(request!==sequence.current)return;
   setAccepted(false);setReview(q);onAvailabilityChange?.(q.available);
   if(q.available)setShown(true);
   else if(shown)setMessage('Spending activation is not currently available. Check your account status above or contact support. Your bot has not been started.');
  }catch{
   if(request!==sequence.current)return;
   setReview(null);setShown(true);onAvailabilityChange?.(false);setMessage('Could not load your spending review. Retry below. Your bot has not been started.');
  }finally{if(request===sequence.current)setLoading(false);}
 }
 useEffect(()=>{void load();return()=>{sequence.current++;onAvailabilityChange?.(false);};},[onAvailabilityChange]);
 async function save(){
  if(!accepted||!review?.available||busy||loading)return;
  const request=++sequence.current;setBusy(true);setMessage('');onAvailabilityChange?.(false);
  try{
   const r=await fetch('/api/work/activation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accepted:true,version:review.consentVersion,reviewKey:review.reviewKey})});const d=await r.json();
   if(!r.ok||d.saved!==true||d.started!==false)throw Error();
   if(request!==sequence.current)return;
   setReview({available:false});setAccepted(false);setMessage('Spending activation saved. Start remains a separate action. Check your current bot status above.');onSaved();
  }catch{
   if(request!==sequence.current)return;
   setAccepted(false);setMessage('Activation could not be confirmed. Refresh this review before retrying; do not pay again.');setReview(null);
  }finally{if(request===sequence.current)setBusy(false);}
 }
 if(!review?.available&&!shown)return null;
 return <section id="spending-activation-review" tabIndex={-1} className="account-details" aria-label="Review paid-credit spending activation">
  {review?.available&&<><h2>Review your bot’s spending limit</h2><p>You have paid credits, but have not activated spending. Allow up to {money(review.customerCapCents!)} in eligible bot services at disclosed rates, within your existing {money(review.dailyLimitCents!)} daily limit.</p><p>This uses existing credits. It creates no payment or subscription, does not start your bot, and does not grant contact permission. After saving, Start is still required. Setup, contact and budget checks continue to apply. <a href="/costs-and-disclosures" target="_blank" rel="noopener noreferrer">Review usage costs and risks</a>.</p><label><input type="checkbox" checked={accepted} disabled={busy||loading} onChange={e=>setAccepted(e.target.checked)}/> I authorize this paid-credit spending limit.</label><button type="button" disabled={!accepted||busy||loading} onClick={()=>void save()}>{busy?'Saving…':'Save spending activation'}</button></>}
  {loading&&<p role="status">Refreshing spending review…</p>}{message&&<p role="status">{message}</p>}{!busy&&(!review||review.available)&&<button type="button" disabled={loading} onClick={()=>void load()}>Refresh activation review</button>}
 </section>;
}
