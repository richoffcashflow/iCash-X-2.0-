'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {SellerAddressInput} from './seller-address-input';
export function InstantSellerAddress(){
 const [token,setToken]=useState(''),[form,setForm]=useState(''),[address,setAddress]=useState(''),[phone,setPhone]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[requestId,setRequestId]=useState('');
 useEffect(()=>{
  const capability=window.location.hash.slice(1),slug=new URLSearchParams(window.location.search).get('form')??'';
  setToken(capability);setForm(slug);setRequestId(crypto.randomUUID());
  if(!capability){setBusy(false);if(!slug)setError('Open the address link in your text message to continue.');return;}
  let active=true;void fetch('/api/seller/instant-address',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'session',token:capability}),cache:'no-store'}).then(async r=>{const d=await r.json();if(!active)return;if(!r.ok)throw Error(d.error);setAddress(d.address??'');}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not open your request.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
 },[]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  try{const r=await fetch('/api/seller/instant-address',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(token?{action:'save',token,address}:{action:'request_link',requestId,form,phone,address})});const data=await r.json();if(!r.ok)throw Error(data.error);setMessage(data.message);}
  catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 return <main className="instant-address-page"><Link className="instant-address-brand" href="/sell">HomeOffer Network</Link><section className="instant-address-card"><span className="instant-address-eyebrow">YOUR CASH OFFER REQUEST</span><h1>{message?'You’re one step closer.':'Which property would you like an offer on?'}</h1>{message?<p role="status">{message}</p>:<><p>{token?'Confirm the full address below so we can check the property details.':'Add your property address to the request you just submitted.'}</p><form onSubmit={submit}><SellerAddressInput value={address} onChange={setAddress}/>{!token&&<label className="instant-address-phone">Mobile number used on your form<input type="tel" autoComplete="tel" required maxLength={30} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(555) 555-1234"/><span>We’ll text a secure link to confirm this address.</span></label>}<button type="submit" disabled={busy||!token&&!form}>{busy?'Please wait…':token?'Confirm my address':'Text my confirmation link'}</button></form></>}{error&&<p className="instant-address-error" role="alert">{error}</p>}<p className="instant-address-note">No obligation to sell. An address submission is not an offer or a contract.</p></section><Link href="/sell/privacy">Privacy policy</Link></main>;
}
