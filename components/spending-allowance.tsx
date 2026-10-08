'use client';
import {useEffect,useState,useCallback,useRef} from 'react';
import {FundingDialog} from '@/components/funding-dialog';
import {priceLabel} from '@/lib/membership-policy';
import {fetchSpendingAllowance,saveSpendingAllowance,type SpendingAllowanceData} from '@/lib/spending-allowance';
export function SpendingAllowance(){
 const [data,setData]=useState<SpendingAllowanceData|null>(null),[open,setOpen]=useState(false),[amount,setAmount]=useState('');
 const [busy,setBusy]=useState(false),[loadError,setLoadError]=useState(''),[saveError,setSaveError]=useState(''),[saved,setSaved]=useState(false);
 const locked=useRef(false),generation=useRef(0);
 const load=useCallback(async()=>{
  if(locked.current)return;
  const request=++generation.current;
  try{
   const next=await fetchSpendingAllowance();
   if(request===generation.current&&!locked.current){setData(next);setLoadError('');}
  }catch(error){
   if(request===generation.current&&!locked.current)setLoadError(error instanceof Error?error.message:'Could not refresh today’s allowance.');
  }
 },[]);
 useEffect(()=>{
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
  return()=>{clearInterval(timer);generation.current++;};
 },[load]);
 const maximum=data?Math.max(0,data.availableCents-data.remainingCents):0;
 const extra=Math.round(Number(amount)*100),valid=/^\d+(\.\d{1,2})?$/.test(amount)&&Number.isSafeInteger(extra)&&extra>0&&extra<=maximum;
 async function save(){
  if(!data||!valid||locked.current)return;
  locked.current=true;generation.current++;setBusy(true);setSaveError('');setSaved(false);
  try{
   const next=await saveSpendingAllowance({day:data.day,extraTotalCents:data.extraCents+extra});
   setData(next);setLoadError('');setOpen(false);setAmount('');setSaved(true);
  }catch(error){setSaveError(error instanceof Error?error.message:'Could not confirm the increase. Refresh to check today’s allowance.');}
  finally{locked.current=false;setBusy(false);}
 }
 return <section id="spending-allowance" className="spending-allowance" aria-label="Today’s spending allowance">
  <div><span>Today’s allowance</span><strong>{data?`${priceLabel(data.remainingCents)} remaining`:'Checking…'}</strong>{data&&<small>Up to {priceLabel(data.limitCents)} today{data.extraCents>0?' · includes your extra allowance':' · 50% daily pace'}</small>}</div>
  {data&&maximum>0&&<button type="button" onClick={()=>{setOpen(true);setSaveError('');setSaved(false);setAmount((Math.min(500,maximum)/100).toFixed(2));}}>Allow more spending today</button>}
  {saved&&data&&<p role="status">Allowance saved. {priceLabel(data.remainingCents)} is available for AI work today.</p>}
  {data?.remainingCents===0&&data.availableCents>0&&<p>Today’s allowance is committed. Allow more or wait for tomorrow’s reset.</p>}
  {loadError&&!open&&<p role="status">{loadError} <button type="button" onClick={()=>void load()}>Refresh allowance</button></p>}
  {saveError&&!open&&<p role="alert">{saveError}</p>}
  {open&&data&&<FundingDialog title="Allow more spending today" onClose={()=>{if(!busy)setOpen(false);}}>
   <form className="allowance-form" aria-busy={busy} onSubmit={e=>{e.preventDefault();void save();}}>
    <p>Use more of your existing credits today. No card charge.</p>
    <label htmlFor="allowance-extra">Additional amount</label>
    <div className="allowance-input"><span>$</span><input id="allowance-extra" inputMode="decimal" aria-describedby="allowance-maximum" value={amount} onChange={e=>{setAmount(e.target.value);setSaveError('');}} disabled={busy}/></div>
    <small id="allowance-maximum">Up to {priceLabel(maximum)} more is available.</small>
    {valid&&<p>New daily limit: <strong>{priceLabel(data.limitCents+extra)}</strong></p>}
    <p>Resets at midnight Central. Your bot stays paused if you paused it.</p>
    <button type="submit" className="fund-button" disabled={!valid||busy}>{busy?'Saving…':'Confirm today’s allowance'}</button>
    {saveError&&<p role="alert">{saveError}</p>}
    {loadError&&<p role="status">{loadError}</p>}
    {(saveError||loadError)&&<button type="button" disabled={busy} onClick={()=>void load()}>Refresh allowance</button>}
   </form>
  </FundingDialog>}
 </section>;
}
