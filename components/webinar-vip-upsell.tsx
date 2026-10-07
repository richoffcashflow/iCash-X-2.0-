'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,ShieldCheck} from 'lucide-react';
import {AccountAccess} from '@/components/account-access';
import {PostPurchaseSetup} from '@/components/post-purchase-setup';
import {StripeEmbeddedCheckout} from '@/components/stripe-embedded-checkout';
import {webinarRequest} from '@/lib/webinar-client';
import {safeVipSession} from '@/lib/webinar-purchase-flow';
import {vipBenefits,vipTermsVersion,vipMonthlyCents,vipUpgradeCents} from '@/lib/vip-policy';
import {priceLabel} from '@/lib/membership-policy';

type RefreshResult={membership:{accessible:boolean;vip?:boolean}|null;needsClaim:boolean};
type Props={phase:'watching'|'ended';email:string;customerName:string;needsClaim:boolean;paidThrough:string|null;retentionEndsAt?:string|null;vipSessionUrl?:string|null;onRefresh:()=>Promise<RefreshResult|null|undefined>;onWorkspace:()=>void;onActive?:(active:boolean)=>void};
export function WebinarVipUpsell({phase,email,customerName,needsClaim,paidThrough,retentionEndsAt,vipSessionUrl,onRefresh,onWorkspace,onActive}:Props){
 const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[claim,setClaim]=useState(false),[declined,setDeclined]=useState(false),[confirming,setConfirming]=useState(false);
 const [form,setForm]=useState<{clientSecret:string;publishableKey:string}|null>(null);
 const alive=useRef(true),checking=useRef(false),operation=useRef(false),refresh=useRef(onRefresh),active=useRef(onActive);
 refresh.current=onRefresh;active.current=onActive;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(phase==='ended')setDeclined(false);},[phase]);
 useEffect(()=>{active.current?.(busy||claim||!!form||confirming);},[busy,claim,form,confirming]);
 async function check(){
  if(checking.current)return false;checking.current=true;
  try{const result=await webinarRequest<{membership:{accessible:boolean;vip?:boolean}|null}>('/api/billing/vip',{cache:'no-store'},30000);
   if(result.membership?.accessible&&result.membership.vip){const verified=await refresh.current();if(!verified?.membership?.vip)throw Error('Your upgrade is paid. Rechecking access; please don’t pay again.');if(alive.current){setConfirming(false);setError('');}return true;}
   return false;
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not confirm your upgrade. Please retry.');return false;}finally{checking.current=false;}
 }
 useEffect(()=>{if(needsClaim)return;const returned=new URLSearchParams(window.location.search).get('upgrade')==='paid';if(returned){setConfirming(true);active.current?.(true);}void check();},[needsClaim]);
 useEffect(()=>{if(!confirming)return;let tries=0;const id=setInterval(()=>{if(!document.hidden&&++tries<=12)void check();if(tries>=12)clearInterval(id);},5000);return()=>clearInterval(id);},[confirming]);
 async function upgrade(){
  if(operation.current||!accepted)return;
  if(needsClaim){setClaim(true);active.current?.(true);return;}
  operation.current=true;setBusy(true);active.current?.(true);setError('');
  try{const out=await webinarRequest<{clientSecret?:string;publishableKey?:string;url?:string}>('/api/billing/vip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upgrade',accepted:true,version:vipTermsVersion,webinar:true,embedded:true})},40000);
   if(!alive.current)return;
   if(out.clientSecret&&out.publishableKey){setForm({clientSecret:out.clientSecret,publishableKey:out.publishableKey});return;}
   if(out.url){const u=new URL(out.url);if(u.protocol==='https:'&&u.hostname==='checkout.stripe.com'){window.location.assign(u.href);return;}}
   throw Error('The upgrade could not open. Your software purchase is saved.');
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'The upgrade could not open.');await check();}
  finally{operation.current=false;if(alive.current)setBusy(false);}
 }
 async function claimed(){
  setBusy(true);setError('');try{const account=await webinarRequest<{signedIn:boolean}>('/api/account?view=core',{cache:'no-store'},30000);if(!account.signedIn)throw Error('Confirm your payment email to continue.');const result=await refresh.current();if(!result?.membership?.accessible||result.needsClaim)throw Error('Sign in with the email used for this purchase. Your payment is saved.');if(alive.current)setClaim(false);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not restore your purchase.');}finally{if(alive.current)setBusy(false);}
 }
 function skip(){if(busy||confirming||form)return;setClaim(false);setDeclined(true);active.current?.(false);if(phase==='ended'){const destination=safeVipSession(vipSessionUrl);if(destination)window.location.assign(destination);}}
 if(declined&&phase==='ended'&&!safeVipSession(vipSessionUrl))return <PostPurchaseSetup email={email} customerName={customerName} needsClaim={needsClaim} onWorkspace={onWorkspace}/>;
 if(declined)return <section className="membership-success"><p className="purchase-receipt"><Check size={16}/>Software payment confirmed</p><h2>{phase==='watching'?'You’re in. Keep watching.':'Your VIP session is ready.'}</h2>{phase==='watching'?<p>Your next step will open when this webinar ends.</p>:<a className="setup-primary" href={safeVipSession(vipSessionUrl)!}>Open my VIP session<ArrowRight size={17}/></a>}</section>;
 return <section className="webinar-vip-upsell" aria-label="VIP upgrade">
  <p className="purchase-receipt"><Check size={16}/>Your software access is paid</p>
  {confirming?<div role="status"><h2>Confirming your VIP upgrade</h2><p>Your payment is being checked. Please don’t pay again.</p><button className="workspace-quiet" onClick={()=>void check()}>Check upgrade</button></div>:form?<><h2>Complete your VIP upgrade</h2><StripeEmbeddedCheckout {...form} onComplete={()=>{setForm(null);setConfirming(true);active.current?.(true);void check();}}/><button className="membership-embedded-back" onClick={()=>{setForm(null);void check();}}>Back to upgrade</button></>:claim?<><h2>Keep VIP with your purchase.</h2><p>Confirm your saved payment email once to connect the upgrade to your account.</p><AccountAccess initialEmail={email} onSignedIn={()=>void claimed()}/><button className="membership-embedded-back" disabled={busy} onClick={()=>setClaim(false)}>Back to upgrade</button></>:<>
   <span className="membership-caption">YOUR VIP UPGRADE</span><h2>{customerName?`${customerName}, take the VIP route.`:'Take the VIP route.'}</h2>
   <div className="membership-price">{priceLabel(vipUpgradeCents)}<small>today</small></div>
   <p className="membership-description">Upgrade your access and go straight to setting up your bot.</p>
   <ul className="membership-includes">{vipBenefits.map(benefit=><li key={benefit}><Check size={15} aria-hidden="true"/>{benefit}</li>)}</ul>
   <p className="membership-renewal" id="vip-upgrade-terms">{priceLabel(vipUpgradeCents)} once today. Your subscription becomes {priceLabel(vipMonthlyCents)}/month total at your next renewal{paidThrough?` on ${new Date(paidThrough).toLocaleDateString('en-US')}`:''}. Your renewal date stays the same. Work credits are separate. Cancel in Help.</p>
   {retentionEndsAt&&Date.parse(retentionEndsAt)>Date.now()&&<p className="membership-note">Your existing subscription discount continues for its remaining term.</p>}
   <label className="membership-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)} aria-describedby="vip-upgrade-terms"/><span>I authorize the VIP upgrade and updated monthly subscription above.</span></label>
   <button className="setup-primary" disabled={!accepted||busy} onClick={()=>void upgrade()}>{busy?'Opening secure upgrade…':`Upgrade to VIP — ${priceLabel(vipUpgradeCents)}`}<ArrowRight size={17}/></button>
   <p className="membership-secure"><ShieldCheck size={14}/>Secure payment through Stripe</p>
  </>}
  {!form&&!confirming&&<button type="button" className="webinar-vip-skip" disabled={busy} onClick={skip}>{phase==='watching'?'Not now — keep watching':safeVipSession(vipSessionUrl)?'No thanks — continue to my VIP session':'No thanks — continue with Standard'}</button>}
  {error&&<p className="membership-error" role="alert">{error}</p>}
 </section>;
}
