'use client';
import {useEffect,useState,useCallback,useRef} from 'react';
import {ArrowUpRight,ArrowRight,LoaderCircle} from 'lucide-react';
import {FundingDialog} from '@/components/funding-dialog';
import {priceLabel} from '@/lib/membership-policy';
import {fetchSpendingAllowance,saveSpendingAllowance,type SpendingAllowanceData} from '@/lib/spending-allowance';
import styles from './spending-allowance.module.css';
export function SpendingAllowance(){
 const [data,setData]=useState<SpendingAllowanceData|null>(null),[open,setOpen]=useState(false),[amount,setAmount]=useState('');
 const [busy,setBusy]=useState(false),[loadError,setLoadError]=useState(''),[saveError,setSaveError]=useState('');
 const locked=useRef(false),generation=useRef(0);
 const load=useCallback(async()=>{
  if(locked.current)return;
  const request=++generation.current;
  try{
   const next=await fetchSpendingAllowance();
   if(request===generation.current&&!locked.current){setData(next);setLoadError('');}
  }catch(error){
   if(request===generation.current&&!locked.current)setLoadError(error instanceof Error?error.message:'Could not refresh usage.');
  }
 },[]);
 useEffect(()=>{
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
  return()=>{clearInterval(timer);generation.current++;};
 },[load]);
 const maximum=data?Math.max(0,data.availableCents-data.remainingCents):0;
 const limitReached=data?.remainingCents===0&&maximum>0;
 const extra=Math.round(Number(amount)*100),valid=/^\d+(\.\d{1,2})?$/.test(amount)&&Number.isSafeInteger(extra)&&extra>0&&extra<=maximum;
 async function save(){
  if(!data||!valid||locked.current)return;
  locked.current=true;generation.current++;setBusy(true);setSaveError('');
  try{
   const next=await saveSpendingAllowance({day:data.day,extraTotalCents:data.extraCents+extra});
   setData(next);setLoadError('');setOpen(false);setAmount('');
  }catch(error){setSaveError(error instanceof Error?error.message:'Could not add more usage. Please refresh and try again.');}
  finally{locked.current=false;setBusy(false);}
 }
 if(!limitReached&&!open&&!loadError&&!saveError)return null;
 return <section id="spending-allowance" className={styles.panel} aria-label="More usage">
  {limitReached&&<div className={styles.actions}><button className={styles.primary} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(true);setSaveError('');setAmount((Math.min(500,maximum)/100).toFixed(2));}}><span>Add more usage</span><ArrowUpRight size={18} aria-hidden="true"/></button><small>Uses your existing credits</small></div>}
  {loadError&&!open&&<div className={styles.feedback} role="status"><p>{loadError}</p><button className={styles.secondary} type="button" onClick={()=>void load()}>Refresh usage</button></div>}
  {saveError&&!open&&<p className={styles.error} role="alert">{saveError}</p>}
  {open&&data&&<FundingDialog title="Add more usage" onClose={()=>{if(!busy)setOpen(false);}}>
   <form className={styles.form} aria-busy={busy} onSubmit={e=>{e.preventDefault();void save();}}>
    <p className={styles.intro}>Use more of your existing credits today.</p>
    <label htmlFor="allowance-extra">How much would you like to use?</label>
    <div className={styles.amount}><span aria-hidden="true">$</span><input id="allowance-extra" inputMode="decimal" aria-describedby="allowance-maximum" value={amount} onChange={e=>{setAmount(e.target.value);setSaveError('');}} disabled={busy}/></div>
    <small className={styles.hint} id="allowance-maximum">Up to {priceLabel(maximum)} more is available.</small>
    {valid&&<div className={styles.review}><span>Available to use today</span><strong>{priceLabel(data.remainingCents+extra)}</strong></div>}
    <p className={styles.note}>Extra usage resets at 12:00 AM Central.</p>
    <button type="submit" className={styles.primary} disabled={!valid||busy}>{busy?<LoaderCircle className={styles.spinner} size={18} aria-hidden="true"/>:null}<span>{busy?'Saving…':'Add more usage'}</span>{!busy&&<ArrowRight size={18} aria-hidden="true"/>}</button>
    {saveError&&<p className={styles.error} role="alert">{saveError}</p>}
    {loadError&&<p className={styles.notice} role="status">{loadError}</p>}
    {(saveError||loadError)&&<button className={styles.secondary} type="button" disabled={busy} onClick={()=>void load()}>Refresh usage</button>}
   </form>
  </FundingDialog>}
 </section>;
}
