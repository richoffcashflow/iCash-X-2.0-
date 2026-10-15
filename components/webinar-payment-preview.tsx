'use client';
import {useState} from 'react';
import {ArrowLeft,Check,LockKeyhole} from 'lucide-react';
import {priceLabel} from '@/lib/membership-policy';

/** Local owner walkthrough. Never collects payment details or calls billing. */
export function WebinarPaymentPreview({priceCents,vipUpgrade=false,onBack,onComplete}:{priceCents:number;vipUpgrade?:boolean;onBack?:()=>void;onComplete:()=>void}){
 const [complete,setComplete]=useState(false);
 const branding=vipUpgrade?<div className="vip-checkout-brand"><span>VIP</span><strong>iCash X upgrade</strong></div>:null;
 if(complete)return <section className={`wb-payment-preview wb-payment-preview-done${vipUpgrade?' vip-checkout':''}`} aria-label="Preview purchase complete">
  {branding}
  <Check size={30} aria-hidden="true"/><h2>{vipUpgrade?"You’re in.":"Don’t leave yet."}</h2>{!vipUpgrade&&<p><strong>Stay here to watch your VIP webinar.</strong><br/>After a confirmed purchase, your next video opens automatically.</p>}<p>Preview purchase complete. No payment was taken.</p><button type="button" className="setup-primary" onClick={onBack??(()=>setComplete(false))}>{onBack?'Back to offer':'Preview again'}</button>
 </section>;
 return <section className={`wb-payment-preview${vipUpgrade?' vip-checkout':''}`} aria-label="Payment preview">
  {branding}
  {onBack&&<button type="button" className="wb-preview-back" onClick={onBack}><ArrowLeft size={16}/>Back to offer</button>}
  <div className="wb-preview-payment-heading"><h2>Payment preview</h2><span>Sample details · No charge</span></div>
  <div className="wb-preview-payment-total"><span>{vipUpgrade?'iCash X VIP upgrade':'iCash X membership'}</span><strong>{priceLabel(priceCents)}<small>{vipUpgrade?' today':'/month'}</small></strong></div>
  <div className="wb-preview-payment-fields">
   <label>Email<input type="email" value="preview@example.com" readOnly tabIndex={-1}/></label>
   <label>Card information<input aria-label="Card number" value="4242 4242 4242 4242" readOnly tabIndex={-1}/><span className="wb-preview-card-details"><input aria-label="Expiry date" value="12 / 30" readOnly tabIndex={-1}/><input aria-label="Security code" value="123" readOnly tabIndex={-1}/></span></label>
   <label>Name on card<input value="Preview Customer" readOnly tabIndex={-1}/></label>
   <label>Billing address<span className="wb-preview-card-details"><input aria-label="Country" value="United States" readOnly tabIndex={-1}/><input aria-label="ZIP code" value="75001" readOnly tabIndex={-1}/></span></label>
  </div>
  <button type="button" className="setup-primary" onClick={()=>{setComplete(true);onComplete();}}><LockKeyhole size={16}/>Preview payment — {priceLabel(priceCents)}</button>
  <p className="wb-preview-payment-note">Customers complete payment in secure Stripe checkout. This preview uses sample details only.</p>
 </section>;
}
