'use client';
import {useEffect,useState} from 'react';
import {X} from 'lucide-react';
import {fundingOutreachNotice,fundingOutreachSchedule} from '@/lib/funding-outreach-notice';
import styles from './funding-outreach-notice.module.css';

export function FundingOutreachNotice({paused,ready,stale,test,onDismiss}:{paused?:boolean;ready:boolean;stale:boolean;test:boolean;onDismiss:()=>void}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const update=()=>setNow(Date.now());const timer=setInterval(update,30000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[]);
 const notice=fundingOutreachNotice({paused,ready,stale,test},now);
 return <section className={styles.notice} aria-label="Credits added">
  <div role="status" aria-live="polite" aria-atomic="true"><strong>{notice.title}</strong><p>{notice.detail}</p>{!test&&<small>{fundingOutreachSchedule}</small>}</div>
  <button type="button" onClick={onDismiss} aria-label="Dismiss funding notice"><X size={18} aria-hidden="true"/></button>
 </section>;
}
