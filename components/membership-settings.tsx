'use client';
import {useEffect,useRef,useState} from 'react';
import {priceLabel} from '@/lib/membership-policy';
import {FundingDialog} from '@/components/funding-dialog';
type MembershipView={state:string;priceCents:number;paidThrough:string|null;cancelAtPeriodEnd:boolean;accessible:boolean;retentionEndsAt?:string|null};
type Offer={eligible:boolean;retryable:boolean;priceCents:number;months:number;version:string};
export function MembershipSettings({locked=false,onChanged}:{locked?:boolean;onChanged?:(stopped?:boolean)=>void|Promise<unknown>}={}){
 const [data,setData]=useState<MembershipView|null>(null),[offer,setOffer]=useState<Offer|null>(null),[loaded,setLoaded]=useState(false),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const operation=useRef(false);
 async function load(){try{const r=await fetch('/api/billing/membership',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();setData(d.membership);setOffer(d.retentionOffer??null);setLoaded(true);}catch{setMessage('Could not load your subscription. Please try again.');}}
 useEffect(()=>{void load();},[]);
 async function act(action:'cancel'|'manage'|'retain'){
  if(operation.current)return;operation.current=true;setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/billing/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(action==='retain'?{accepted:true,version:offer?.version,priceCents:offer?.priceCents,months:6}:{})}),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw Error(d.error);
   if(d.url){const url=new URL(d.url);if(url.protocol!=='https:'||url.hostname!=='billing.stripe.com')throw Error('Billing portal unavailable.');window.location.assign(url.href);}
   else{setMessage(d.message);setReview(false);await onChanged?.(d.stopped===true);await load();}
  }catch(e){setMessage(e instanceof Error&&!['TimeoutError','AbortError'].includes(e.name)?e.message:'Could not confirm this change. Check the current status before retrying.');await load();await onChanged?.();}
  finally{operation.current=false;setBusy(false);}
 }
 const cancelling=data?.state==='cancel_requested',canCancel=data&&data.state!=='cancelled'&&!cancelling;
 const offerAvailable=offer&&(offer.eligible||offer.retryable);
 return <div className="membership-settings">{data?<>
  <div className="membership-summary"><strong>{priceLabel(data.retentionEndsAt&&Date.parse(data.retentionEndsAt)>Date.now()?data.priceCents-Math.round(data.priceCents*.5):data.priceCents)}/month</strong><span>Software subscription</span></div>
  {data.retentionEndsAt&&Date.parse(data.retentionEndsAt)>Date.now()&&<p>50% off through {new Date(data.retentionEndsAt).toLocaleDateString()}. Then {priceLabel(data.priceCents)}/month.</p>}
  {cancelling&&<p role="status">Your bot is stopped. Cancellation is finishing automatically. Your unused credits are saved.</p>}
  {!data.accessible&&['pending','cancelled'].includes(data.state)&&<a className="fund-button" href="/join">Renew subscription</a>}
  {data.state!=='pending'&&<button className={locked&&!['cancelled','cancel_requested'].includes(data.state)?'fund-button':'membership-payment-link'} disabled={busy} onClick={()=>void act('manage')}>{locked&&!['cancelled','cancel_requested'].includes(data.state)?'Renew subscription':'Payment & invoices'}</button>}
  {canCancel&&<button className="membership-cancel-link" type="button" disabled={busy} onClick={()=>{setMessage('');setReview(true);}}>Cancel subscription</button>}
 </>:<>{loaded?<p>No monthly subscription is linked.</p>:<p>Loading subscription…</p>}</>}
 {message&&!review&&<p role="status">{message}</p>}
 {review&&<FundingDialog title={offerAvailable?'Stay for 50% less':'Cancel subscription?'} onClose={()=>!busy&&setReview(false)}><div className="membership-retention-review">
  {offerAvailable?<><p className="retention-price">{priceLabel(offer!.priceCents)}<span>/month for 6 months</span></p><p>50% off your subscription. Then {priceLabel(data!.priceCents)}/month. Credits are separate. Cancel anytime.</p><p className="retention-note">Starts with your next renewal. No charge today.</p><button className="fund-button" disabled={busy} onClick={()=>void act('retain')}>{busy?'One moment…':offer!.retryable?'Retry offer':'Keep my subscription'}</button></>:<p>Your access and new bot work stop immediately. Unused credits stay saved until you renew. Work already sent may finish.</p>}
  <button className="retention-cancel-button" disabled={busy} onClick={()=>void act('cancel')}>{busy?'One moment…':offerAvailable?'No thanks, cancel':'Cancel subscription'}</button>
  {offerAvailable&&<p className="retention-note">Cancelling ends access and stops new work. Unused credits stay saved.</p>}
  {message&&<p role="alert">{message}</p>}
 </div></FundingDialog>}
 </div>;
}
