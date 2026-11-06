'use client';
import {useEffect,useRef,useState} from 'react';
import {validWorkValue} from '@/lib/work-value';
import {WorkValueReceipt} from './work-value-receipt';
import {ArrowUpRight,Search,Check,MessageCircle,Phone} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
import {subscribeWorkspaceChanges} from '@/lib/workspace-events-client';
import {activityPeriods,type ActivityDays} from '@/lib/activity-report';
import {validOpportunityProgress,type OpportunityProgressData} from '@/lib/opportunity-progress';
import styles from './opportunity-progress.module.css';
export type {OpportunityProgressData} from '@/lib/opportunity-progress';
export function OpportunityProgress({apiBase='/api/work',days=1,timezone='UTC',paused,onResponses,onActivity,onText}:{apiBase?:string;days?:ActivityDays;timezone?:string;botAvailable:boolean;paused:boolean;stale:boolean;onResponses:()=>void;onActivity:()=>void;onText?:(screeningId:string,threadId:string)=>void}){
 const scope=JSON.stringify([apiBase,days,timezone]);
 const [snapshot,setSnapshot]=useState<{scope:string;progress:OpportunityProgressData|null}|null>(null);
 const previous=useRef<{scope:string;progress:OpportunityProgressData|null}|null>(null),activity=useRef(onActivity);activity.current=onActivity;
 useEffect(()=>{
  let mounted=true,inFlight=false,refreshQueued=false;const controller=new AbortController();
  async function load(){
   if(document.hidden)return;if(inFlight){refreshQueued=true;return;}inFlight=true;
   try{
    const params=new URLSearchParams({days:String(days),timezone});
    const result=await webinarRequest<{progress:unknown}>(`${apiBase}/progress?${params}`,{cache:'no-store',signal:controller.signal});
    if(!mounted)return;
    const next=result.progress;if(next!==null&&!validOpportunityProgress(next,days,timezone))throw Error('Invalid progress response');
    const prior=previous.current?.scope===scope?previous.current.progress:null;
    if(next&&prior&&(next.responded!==prior.responded||next.eligible!==prior.eligible))activity.current();
    const saved={scope,progress:next};previous.current=saved;setSnapshot(saved);
   }catch{/* Keep confirmed progress while the next background refresh retries. */}finally{inFlight=false;if(mounted&&refreshQueued){refreshQueued=false;void load();}}
  }
  void load();const unsubscribe=apiBase==='/api/work'?subscribeWorkspaceChanges(load):()=>{},timer=setInterval(load,60000);
  document.addEventListener('visibilitychange',load);window.addEventListener('icash:credits-funded',load);
  return()=>{mounted=false;controller.abort();unsubscribe();clearInterval(timer);document.removeEventListener('visibilitychange',load);window.removeEventListener('icash:credits-funded',load);};
 },[paused,apiBase,days,timezone,scope]);
 const progress=snapshot?.scope===scope?snapshot.progress:null;
 if(!progress)return null;
 const p=progress;
 const status=paused?'paused':p.status;
 const heading=status==='paused'?'Your search is paused':status==='membership_required'?'Your work is saved':status==='budget_reached'?'Your work is waiting for credits':status==='settling'?'Earlier work is awaiting confirmation':'Your opportunity search';
 const detail=status==='paused'?'Resume your bot whenever you’re ready.':status==='membership_required'?'Restore your membership to continue.':status==='budget_reached'?'New work resumes when available credits can cover it.':status==='settling'?'Earlier work is awaiting confirmation before those credits can be used again. No action is needed from you for this check.':`${p.queued?`${p.queued.toLocaleString()} ${p.queued===1?'property':'properties'} queued for screening. `:''}Your recorded research and seller responses are below.`;
 const steps=[{value:p.screened,label:'Properties screened',Icon:Search},{value:p.eligible,label:'Eligible matches',Icon:Check},{value:p.contacted,label:'Sellers contacted',Icon:Phone},{value:p.responded,label:'Sellers replied',Icon:MessageCircle}];
 return <>{onText&&validWorkValue(p.receipt)&&<WorkValueReceipt apiBase={apiBase} progress={{...p,status}} receipt={p.receipt} onText={onText}/>}<section className={styles.panel} aria-label="Opportunity progress">
  <div className={styles.top}><span className={styles.eyebrow}>Your opportunity search</span><span className={styles.period}>{activityPeriods.find(period=>period.days===days)?.label}</span></div>
  <div aria-live="polite" aria-atomic="true"><h3>{heading}</h3><p className={styles.description}>{detail}</p></div>
  <div className={styles.metrics}>{steps.map(({value,label,Icon})=><div key={label} className={styles.metric}><span><Icon size={15} aria-hidden="true"/>{label}</span><strong key={value} className={styles.count}>{value.toLocaleString()}</strong></div>)}</div>
  <div className={styles.bottom}><p>{p.responded>0?<><strong>{p.responded===1?'A seller replied.':`${p.responded.toLocaleString()} sellers replied.`}</strong> Open the conversation and see the next step.</>:p.eligible>0?<><strong>{p.eligible.toLocaleString()} {p.eligible===1?'property meets':'properties meet'} the financial checks.</strong> Seller responses appear in your lead list.</>:'Real progress appears here as your bot works.'}</p>{p.responded>0&&<button type="button" onClick={onResponses}>View responses<ArrowUpRight size={16} aria-hidden="true"/></button>}</div>
 </section></>;
}
