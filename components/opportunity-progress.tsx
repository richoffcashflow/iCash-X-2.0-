'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Search,Check,MessageCircle,Phone} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
import {subscribeWorkspaceChanges} from '@/lib/workspace-events-client';
import styles from './opportunity-progress.module.css';
export type OpportunityProgressData={budgetId:number;startedAt:string;limitCents?:number;spendingMode?:string;fundedBaselineCents?:number;pacingDays?:number;pacingHours?:number;dailyPercent?:number;dailyLimitCents?:number;hourlyLimitCents?:number;releasedCents?:number;spentCents:number;pendingCents:number;remainingCents:number;queued:number;screened:number;eligible:number;contacted:number;responded:number;callsBudgetHeld?:number;status:'paused'|'membership_required'|'settling'|'paced'|'budget_reached'|'working'|'ready'|'waiting'};
export function OpportunityProgress({apiBase='/api/work',botAvailable,paused,stale,onResponses,onActivity}:{apiBase?:string;botAvailable:boolean;paused:boolean;stale:boolean;onResponses:()=>void;onActivity:()=>void}){
 const [progress,setProgress]=useState<OpportunityProgressData|null>(null),[delayed,setDelayed]=useState(false);
 const previous=useRef<OpportunityProgressData|null>(null),activity=useRef(onActivity);activity.current=onActivity;
 useEffect(()=>{
  let mounted=true,inFlight=false,refreshQueued=false;const controller=new AbortController();
  async function load(){
   if(document.hidden)return;if(inFlight){refreshQueued=true;return;}inFlight=true;
   try{
    const result=await webinarRequest<{progress:OpportunityProgressData|null}>(`${apiBase}/progress`,{cache:'no-store',signal:controller.signal});
    if(!mounted)return;
    const next=result.progress,prior=previous.current;
    if(next&&prior&&(next.responded!==prior.responded||next.eligible!==prior.eligible))activity.current();
    previous.current=next;setProgress(next);setDelayed(false);
   }catch{if(mounted)setDelayed(true);}finally{inFlight=false;if(mounted&&refreshQueued){refreshQueued=false;void load();}}
  }
  void load();const unsubscribe=apiBase==='/api/work'?subscribeWorkspaceChanges(load):()=>{},timer=setInterval(load,60000);
  document.addEventListener('visibilitychange',load);window.addEventListener('icash:credits-funded',load);
  return()=>{mounted=false;controller.abort();unsubscribe();clearInterval(timer);document.removeEventListener('visibilitychange',load);window.removeEventListener('icash:credits-funded',load);};
 },[paused,apiBase]);
 if(!progress)return null;
 const p=progress,unavailable=delayed||stale;
 const status=paused?'paused':p.status;
 const live=botAvailable&&!unavailable&&status==='working';
 const heading=unavailable?'Your latest saved progress':status==='paused'?'Your search is paused':status==='membership_required'?'Your work is saved':status==='paced'?'Your search continues automatically':status==='budget_reached'?'Your work is waiting for credits':status==='settling'?'Your current work is finishing':status==='working'?'Finding your next opportunity':status==='ready'?'Your search is queued':'Your work is saved';
 const detail=unavailable?'Live updates are delayed. These are your last confirmed counts.':status==='paused'?'Resume your bot whenever you’re ready.':status==='membership_required'?'Restore your membership to continue.':status==='paced'?'Your bot continues automatically as eligible work becomes available.':status==='budget_reached'?'New work resumes when available credits can cover it.':status==='settling'?'Confirmed costs release unused commitments automatically.':status==='working'?`${p.queued?`${p.queued.toLocaleString()} ${p.queued===1?'property':'properties'} being screened. `:''}Checking the numbers and reaching eligible owners.`:status==='ready'?'Your bot will screen properties, check the numbers, and reach eligible owners.':'New opportunities will appear as eligible work becomes available.';
 const steps=[{value:p.screened,label:'Properties screened',Icon:Search},{value:p.eligible,label:'Eligible matches',Icon:Check},{value:p.contacted,label:'Sellers contacted',Icon:Phone},{value:p.responded,label:'Sellers replied',Icon:MessageCircle}];
 return <section className={styles.panel} aria-label="Opportunity progress">
  <div className={styles.top}><span className={styles.eyebrow}>{live&&<span className={styles.dot} aria-hidden="true"/>}{live?'Working now':'Your opportunity search'}</span></div>
  <div aria-live="polite" aria-atomic="true"><h3>{heading}</h3><p className={styles.description}>{detail}</p></div>
  <div className={styles.metrics}>{steps.map(({value,label,Icon})=><div key={label} className={styles.metric}><span><Icon size={15} aria-hidden="true"/>{label}</span><strong key={value} className={styles.count}>{value.toLocaleString()}</strong></div>)}</div>
  <div className={styles.bottom}><p>{p.responded>0?<><strong>{p.responded===1?'A seller replied.':`${p.responded.toLocaleString()} sellers replied.`}</strong> Open the conversation and see the next step.</>:p.eligible>0?<><strong>{p.eligible.toLocaleString()} {p.eligible===1?'property meets':'properties meet'} the financial checks.</strong> Seller responses appear in your lead list.</>:'Real progress appears here as your bot works.'}</p>{p.responded>0&&<button type="button" onClick={onResponses}>View responses<ArrowUpRight size={16} aria-hidden="true"/></button>}</div>
 </section>;
}
