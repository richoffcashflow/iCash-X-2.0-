'use client';
import {useState} from 'react';
import {createPortal} from 'react-dom';
import {CallConversation} from './call-conversation';
import {receiptLastWork,receiptNextStep,valueDollars,type WorkValueReceipt} from '@/lib/work-value';
import type {OpportunityProgressData} from '@/lib/opportunity-progress';
import styles from './opportunity-progress.module.css';

export function WorkValueReceipt({progress:p,receipt:r,apiBase,onText}:{progress:OpportunityProgressData;receipt:WorkValueReceipt;apiBase:string;onText:(screeningId:string,threadId:string)=>void}){
 const [openCall,setOpenCall]=useState('');
 const host=typeof document==='undefined'?null:document.getElementById('workspace-work-receipt');
 if(!host)return null;
 const e=r.evidence,period=p.days===1?'today':'in '+p.days+' days';
 return createPortal(<section className={styles.receipt} aria-label="Work credit receipt">
  <header><h3>Interested sellers <strong>{r.interested.toLocaleString()}</strong></h3><span>{p.days===1?'Today':'Last '+p.days+' days'}</span></header>
  <p><b>{valueDollars(r.spentCents)} used {period}</b> · {valueDollars(r.availableCents)} available now{r.heldCents>0?' · '+valueDollars(r.heldCents)+' held':''}</p>
  <p>{p.contacted} {p.contacted===1?'property had':'properties had'} outreach · {p.responded} {p.responded===1?'had a seller reply':'had seller replies'}</p>
  {e&&<div className={styles.evidence}><q>{e.quote}</q>
   {e.source==='text'&&e.threadId?<button type="button" onClick={()=>onText(e.screeningId,e.threadId!)}>View seller text</button>:
    <button type="button" aria-expanded={openCall===e.sourceId} onClick={()=>setOpenCall(openCall===e.sourceId?'':e.sourceId)}>{openCall===e.sourceId?'Close seller call':'View seller call'}</button>}
   {e.source!=='text'&&openCall===e.sourceId&&<CallConversation key={e.sourceId} apiBase={apiBase} id={e.sourceId} source={e.source==='reception'?'reception':'outbound'} initiallyOpen party="seller" interested completedAt={e.at}/>}
  </div>}
  <p>{receiptNextStep(p,r)}</p>
  {r.nextReply&&!r.callbackAt&&p.status!=='paused'&&p.status!=='membership_required'&&p.health?.status!=='blocked'&&
   <button type="button" className={styles.viewRequest} onClick={()=>{if(r.nextReply)onText(r.nextReply.screeningId,r.nextReply.threadId);}}>View follow-up</button>}
  <small>Last confirmed · {receiptLastWork(r,p.timezone)}</small>
 </section>,host);
}
