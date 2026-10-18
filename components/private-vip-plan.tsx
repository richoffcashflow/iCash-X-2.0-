'use client';
import {useEffect,useRef,useState} from 'react';
import {vipBenefits} from '@/lib/vip-policy';
import {privateVipVersion,type PrivateVipView} from '@/lib/private-vip-policy';
import {FundingDialog} from '@/components/funding-dialog';
export function PrivateVipPlan({cancellationOnly=false,onChanged}:{cancellationOnly?:boolean;onChanged?:()=>void|Promise<unknown>}){
 const [plan,setPlan]=useState<PrivateVipView|null>(null),[vip,setVip]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[review,setReview]=useState(false),[error,setError]=useState('');const operation=useRef(false);
 async function load(){try{const r=await fetch('/api/billing/private-vip',{cache:'no-store',signal:AbortSignal.timeout(30000)});const d=await r.json();if(!r.ok)throw Error(d.error);setPlan(d.privateVip);setVip(d.membership?.vip===true);setLoaded(true);}catch(e){setError(e instanceof Error?e.message:'Could not confirm VIP.');}}
 useEffect(()=>{void load();},[]);
 async function act(action:'upgrade'|'downgrade'|'keep_vip'|'manage'){
  if(operation.current||action==='upgrade'&&!accepted)return;operation.current=true;setBusy(true);setError('');
  try{const r=await fetch('/api/billing/private-vip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,accepted:true,version:privateVipVersion}),signal:AbortSignal.timeout(40000)});const d=await r.json();if(!r.ok)throw Error(d.error);if(d.url){const url=new URL(d.url);if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw Error('Secure billing unavailable');window.location.assign(url.href);}else{setReview(false);await load();await onChanged?.();}}
  catch(e){setError(e instanceof Error?e.message:'Could not confirm this change. Refresh before retrying.');}finally{operation.current=false;setBusy(false);}
 }
 const subscribed=!!plan?.hasSubscription&&!['cancelled','expired'].includes(plan.state),ending=plan?.cancelAtPeriodEnd,until=plan?.paidUntil?new Date(plan.paidUntil).toLocaleDateString('en-US'):null;
 return <section className="vip-plan"><div className="vip-plan-heading"><span>{vip?'VIP active':'Upgrade to VIP'}</span><strong>$50<small>/month</small></strong></div>
 {!cancellationOnly&&<ul>{vipBenefits.map(b=><li key={b}>{b}</li>)}</ul>}
 <p>Your free Standard access stays included.</p>
 {ending&&<p>VIP renewal is cancelled.{until?` VIP continues through ${until}.`:''} Then continue with free Standard.</p>}
 {loaded?(subscribed?<><button className="membership-payment-link" disabled={busy} onClick={()=>void act('manage')}>Payment & invoices</button><button className="membership-payment-link" disabled={busy} onClick={()=>setReview(true)}>{ending?'Keep VIP for $50/month':'Cancel VIP renewal'}</button></>:vip?<p>VIP continues through {until}. Free Standard remains afterward.</p>:cancellationOnly?<p>You have no paid VIP subscription to cancel.</p>:<><p>$50 today, then $50/month until cancelled. VIP starts after payment.</p><label className="membership-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>I agree to $50/month for VIP and the <a href="/costs-and-disclosures#refunds" target="_blank" rel="noopener noreferrer">billing policy</a>.</span></label><button className="fund-button" disabled={busy||!accepted} onClick={()=>void act('upgrade')}>{busy?'Opening secure checkout…':'Upgrade to VIP — $50/month'}</button></>):<p>Checking VIP…</p>}
 {review&&<FundingDialog title={ending?'Keep VIP':'Cancel VIP renewal?'} onClose={()=>{if(!busy)setReview(false);}}><p>{ending?'VIP will renew at $50/month. No extra charge today.':`Stop future VIP renewals.${until?` Keep VIP through ${until}.`:''} Your free Standard access, leads and credits stay saved.`}</p><button className="fund-button" disabled={busy} onClick={()=>void act(ending?'keep_vip':'downgrade')}>{busy?'Confirming…':ending?'Keep VIP for $50/month':'Cancel VIP renewal'}</button></FundingDialog>}
 {error&&<p role="alert">{error} <button className="membership-payment-link" disabled={busy} onClick={()=>void load()}>Refresh status</button></p>}
 </section>;
}
