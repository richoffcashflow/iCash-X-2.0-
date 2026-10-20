'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Search,Check,MessageCircle,Phone} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
import styles from './opportunity-progress.module.css';
export type OpportunityProgressData={budgetId:number;startedAt:string;limitCents:number;pacingDays?:number;pacingHours?:number;dailyPercent?:number;dailyLimitCents?:number;hourlyLimitCents?:number;releasedCents?:number;spentCents:number;pendingCents:number;remainingCents:number;queued:number;screened:number;eligible:number;contacted:number;responded:number;callsBudgetHeld?:number;status:'paused'|'membership_required'|'settling'|'paced'|'budget_reached'|'working'|'ready'|'waiting'};
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
export function OpportunityProgress({botAvailable,paused,stale,onResponses,onActivity}:{botAvailable:boolean;paused:boolean;stale:boolean;onResponses:()=>void;onActivity:()=>void}){
 const [progress,setProgress]=useState<OpportunityProgressData|null>(null),[delayed,setDelayed]=useState(false);
 const previous=useRef<OpportunityProgressData|null>(null),activity=useRef(onActivity);activity.current=onActivity;
 useEffect(()=>{
  let mounted=true,inFlight=false,refreshQueued=false;const controller=new AbortController();
  async function load(){
   if(document.hidden)return;if(inFlight){refreshQueued=true;return;}inFlight=true;
   try{
    const result=await webinarRequest<{progress:OpportunityProgressData|null}>('/api/work/progress',{cache:'no-store',signal:controller.signal});
    if(!mounted)return;
    const next=result.progress,prior=previous.current;
    if(next&&prior&&(next.responded!==prior.responded||next.eligible!==prior.eligible))activity.current();
    previous.current=next;setProgress(next);setDelayed(false);
   }catch{if(mounted)setDelayed(true);}finally{inFlight=false;if(mounted&&refreshQueued){refreshQueued=false;void load();}}
  }
  void load();const timer=setInterval(load,paused?15000:4000);
  document.addEventListener('visibilitychange',load);window.addEventListener('icash:credits-funded',load);
  return()=>{mounted=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);window.removeEventListener('icash:credits-funded',load);};
 },[paused]);
 if(!progress)return null;
 const p=progress,unavailable=delayed||stale;
 const status=paused?'paused':p.status;
 const live=botAvailable&&!unavailable&&status==='working';
 const heading=unavailable?'Your latest saved progress':status==='paused'?'Your search is paused':status==='membership_required'?'Your work is saved':status==='paced'?'Your search continues automatically':status==='budget_reached'?'Your search allowance is complete':status==='settling'?'Your current work is finishing':status==='working'?'Finding your next opportunity':status==='ready'?'Your search is queued':'Your work is saved';
 const detail=unavailable?'Live updates are delayed. These are your last confirmed counts.':status==='paused'?'Resume your bot whenever you’re ready.':status==='membership_required'?'Restore your membership to continue.':status==='paced'?'Your next search allowance is building. New opportunities resume automatically; seller replies and active deals continue.':status==='budget_reached'?((p.callsBudgetHeld??0)>0?'New seller calls are waiting because the outreach allowance is nearly used up. Remaining credits are available for seller replies and active deals.':'The remaining credits are available for seller replies and active deals.'):status==='settling'?'Completed usage releases any unused allowance automatically.':status==='working'?`${p.queued?`${p.queued.toLocaleString()} ${p.queued===1?'property':'properties'} being screened. `:''}Checking the numbers and reaching eligible owners.`:status==='ready'?'Your bot will screen properties, check the numbers, and reach eligible owners.':'New opportunities will appear as eligible work becomes available.';
 const steps=[{value:p.screened,label:'Properties screened',Icon:Search},{value:p.eligible,label:'Eligible matches',Icon:Check},{value:p.contacted,label:'Sellers contacted',Icon:Phone},{value:p.responded,label:'Sellers replied',Icon:MessageCircle}];
 return <section className={styles.panel} aria-label="Opportunity progress">
  <div className={styles.top}><span className={styles.eyebrow}>{live&&<span className={styles.dot} aria-hidden="true"/>}{live?'Working now':'Your opportunity search'}</span><span className={styles.allowance}>{(p.dailyPercent===25||p.dailyPercent===50)&&typeof p.dailyLimitCents==='number'?<>Up to {money(p.dailyLimitCents)} per 24 hours</>:<>Your search plan · Up to {money(p.limitCents)} total</>}</span></div>
  <div aria-live="polite" aria-atomic="true"><h3>{heading}</h3><p className={styles.description}>{detail}</p></div>
  <div className={styles.metrics}>{steps.map(({value,label,Icon})=><div key={label} className={styles.metric}><span><Icon size={15} aria-hidden="true"/>{label}</span><strong key={value} className={styles.count}>{value.toLocaleString()}</strong></div>)}</div>
  <div className={styles.bottom}><p>{p.responded>0?<><strong>{p.responded===1?'A seller replied.':`${p.responded.toLocaleString()} sellers replied.`}</strong> Open the conversation and see the next step.</>:p.eligible>0?<><strong>{p.eligible.toLocaleString()} {p.eligible===1?'property meets':'properties meet'} the financial checks.</strong> Seller responses appear in your lead list.</>:'Real progress appears here as your bot works.'}</p>{p.responded>0&&<button type="button" onClick={onResponses}>View responses<ArrowUpRight size={16} aria-hidden="true"/></button>}</div>
  <span className={styles.scope}>Start fast, then pace · A small first batch unlocks when credits arrive. New-opportunity work uses up to 50% of that funded balance per rolling 24 hours, with a 50% total search allowance. The rest stays available for replies and active deals.</span>
  <span className={styles.scope}>New outreach runs from 9 AM–9 PM in the recipient’s time zone when known; otherwise Central Time. Research can continue overnight. Active conversations and requested callbacks can continue outside these hours.</span>
 </section>;
}
