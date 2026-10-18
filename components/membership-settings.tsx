'use client';
import {PrivateVipPlan} from '@/components/private-vip-plan';
import {vipBenefits,vipRetentionTerms} from '@/lib/vip-policy';
import {VipPlan} from '@/components/vip-plan';
import {useEffect,useRef,useState} from 'react';
import {priceLabel} from '@/lib/membership-policy';
import {FundingDialog} from '@/components/funding-dialog';
type MembershipView={complimentary?:boolean;vip?:boolean;vipRetained?:boolean;vipUntil?:string|null;pendingDowngrade?:boolean;state:string;priceCents:number;paidThrough:string|null;cancelAtPeriodEnd:boolean;accessible:boolean;retentionEndsAt?:string|null};
type Offer={eligible:boolean;retryable:boolean;priceCents:number;plan:'vip';version:string};
export function MembershipSettings({locked=false,cancellationOnly=false,planOnly=false,initialUpgradeReview=false,onClosed,onChanged}:{locked?:boolean;cancellationOnly?:boolean;planOnly?:boolean;initialUpgradeReview?:boolean;onClosed?:()=>void;onChanged?:(stopped?:boolean)=>void|Promise<unknown>}={}){
 const [data,setData]=useState<MembershipView|null>(null),[offer,setOffer]=useState<Offer|null>(null),[loaded,setLoaded]=useState(false),[review,setReview]=useState(cancellationOnly),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const operation=useRef(false);
 async function load(){try{if(new URLSearchParams(window.location.search).has('vip_session'))await fetch('/api/billing/vip',{cache:'no-store',signal:AbortSignal.timeout(30000)});const r=await fetch('/api/billing/membership',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();setData(d.membership);setOffer(d.retentionOffer??null);setLoaded(true);}catch{setMessage('Could not load your subscription. Please try again.');}}
 useEffect(()=>{void load();},[]);
 async function act(action:'cancel'|'manage'|'retain_vip'){
  if(operation.current)return;operation.current=true;setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/billing/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(action==='retain_vip'?{accepted:true,version:offer?.version,priceCents:offer?.priceCents}:{})}),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw Error(d.error);
   if(d.url){const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='billing.stripe.com')throw Error('Billing portal unavailable.');window.location.assign(url.href);}
   else{setMessage(d.message);setReview(false);await onChanged?.(d.stopped===true);await load();}
  }catch(e){setMessage(e instanceof Error&&!['TimeoutError','AbortError'].includes(e.name)?e.message:'Could not confirm this change. Check the current status before retrying.');await load();await onChanged?.();}
  finally{operation.current=false;setBusy(false);}
 }
 const cancelling=data?.state==='cancel_requested',canCancel=data&&data.state!=='cancelled'&&!cancelling;
 const offerAvailable=offer&&(offer.eligible||offer.retryable);
 if(data?.complimentary){
  const content=<div className="membership-settings"><div className="membership-summary"><strong>Free Standard access</strong><span>Private invitation</span></div><PrivateVipPlan cancellationOnly={cancellationOnly} onChanged={async()=>{await load();await onChanged?.();}}/></div>;
  return cancellationOnly?<FundingDialog title="Your access" onClose={()=>onClosed?.()}>{content}</FundingDialog>:content;
 }
 return <div className="membership-settings">{!cancellationOnly&&(data?<>
  {!planOnly&&<><div className="membership-summary"><strong>{priceLabel(data.retentionEndsAt&&Date.parse(data.retentionEndsAt)>Date.now()?data.priceCents-Math.round(data.priceCents*.5):data.priceCents)}/month</strong><span>Software subscription</span></div>
  {data.retentionEndsAt&&Date.parse(data.retentionEndsAt)>Date.now()&&<p>50% off through {new Date(data.retentionEndsAt).toLocaleDateString()}. Then {priceLabel(data.priceCents)}/month.</p>}
  {cancelling&&<p role="status">Your bot is stopped. Cancellation is finishing automatically. Your unused credits are saved.</p>}
  {!data.accessible&&['pending','cancelled'].includes(data.state)&&<a className="fund-button" href="/join">Renew subscription</a>}
  {data.state!=='pending'&&<button className={locked&&!['cancelled','cancel_requested'].includes(data.state)?'fund-button':'membership-payment-link'} disabled={busy} onClick={()=>void act('manage')}>{locked&&!['cancelled','cancel_requested'].includes(data.state)?'Renew subscription':'Payment & invoices'}</button>}</>}
  {planOnly&&!data.accessible&&<p>Renew your subscription to switch plans. <a href="/join">Renew subscription</a></p>}
  {data.accessible&&<VipPlan initialUpgradeReview={initialUpgradeReview} vip={data.vip===true} retained={data.vipRetained===true} pendingDowngrade={data.pendingDowngrade===true} vipUntil={data.vipUntil??null} paidThrough={data.paidThrough} discountActive={!!data.retentionEndsAt&&Date.parse(data.retentionEndsAt)>Date.now()} onChanged={async()=>{await load();await onChanged?.();}}/>}

 </>:<>{loaded?<p>No monthly subscription is linked.</p>:<p>Loading subscription…</p>}</>)}
 {message&&!review&&!cancellationOnly&&<p role="status">{message}{!loaded&&<button type="button" className="membership-payment-link" onClick={()=>{setMessage('');void load();}}>Retry</button>}</p>}
 {cancellationOnly&&(!review||!canCancel)&&<FundingDialog title="Subscription" onClose={()=>onClosed?.()}><p role="status">{message||(!loaded?'Loading subscription…':cancelling?'Cancellation is finishing. Your unused credits are saved.':data?.state==='cancelled'?'Your subscription is cancelled. Your unused credits are saved.':'No monthly subscription is linked.')}</p>{!loaded&&<button type="button" onClick={()=>void load()}>Retry</button>}</FundingDialog>}
 {review&&canCancel&&<FundingDialog title={offerAvailable?(data?.vip?'Keep VIP for $50/month':'Get VIP for $50/month'):'Cancel subscription?'} onClose={()=>{if(!busy){setReview(false);onClosed?.();}}}><div className="membership-retention-review">
  {offerAvailable?<><p className="retention-price">$50<span>/month total</span></p><ul>{vipBenefits.map(benefit=><li key={benefit}>{benefit}</li>)}</ul><p className="retention-note">VIP starts now. No extra charge today. Your renewal date stays the same.</p><p>{vipRetentionTerms}</p><button className="fund-button" disabled={busy} onClick={()=>void act('retain_vip')}>{busy?'One moment…':offer!.retryable?'Retry VIP offer':data?.vip?'Keep VIP for $50/month':'Get VIP for $50/month'}</button></>:<p>Your access and new bot work stop immediately. Unused credits stay saved until you renew. Work already sent may finish.</p>}
  <button className="retention-cancel-button" disabled={busy} onClick={()=>void act('cancel')}>{busy?'One moment…':offerAvailable?'No thanks, cancel':'Cancel subscription'}</button>
  {offerAvailable&&<p className="retention-note">Cancelling ends access and stops new work. Unused credits stay saved.</p>}
  {message&&<p role="alert">{message}</p>}
 </div></FundingDialog>}
 </div>;
}
