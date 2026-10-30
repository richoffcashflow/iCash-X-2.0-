'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supportRequest} from '@/lib/support-client';
import type {QualityCase,SupportQualityReport} from '@/lib/support-quality';
export function SupportQualityPanel({onOpen,onDenied}:{onOpen:(item:QualityCase)=>void;onDenied:()=>void}){
 const [report,setReport]=useState<SupportQualityReport|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[topic,setTopic]=useState('all');
 const generation=useRef(0),denied=useRef(onDenied);denied.current=onDenied;
 const load=useCallback(async()=>{
  const seq=++generation.current;setBusy(true);setError('');
  try{const {ok,status,data}=await supportRequest<SupportQualityReport&{error?:string}>('/api/support/admin/quality',{cache:'no-store'});
   if(seq!==generation.current)return;
   if(status===403){setReport(null);denied.current();throw Error('Sign in with a support operator account.');}
   if(!ok)throw Error(data.error||'Support quality could not load.');setReport(data);setTopic(current=>current==='all'||data.topics.some(t=>t.topic===current)?current:'all');
  }catch(e){if(seq===generation.current){setReport(null);setError(e instanceof Error?e.message:'Support quality could not load.');}}finally{if(seq===generation.current)setBusy(false);}
 },[]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 const cases=report?.cases.filter(c=>topic==='all'||c.topic===topic)??[];
 return <section className="support-notice desk-quality" aria-label="Support quality">
  <h2>Support quality</h2><p>Find recurring questions, repeated replies and conversations that need another look. These flags call for review; they do not confirm a bug or a fix.</p>
  <button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Reviewing conversations…':'Refresh support quality'}</button>
  {error&&<p role="alert">{error}</p>}
  {report&&<><p>{report.needsReview} open conversations flagged · {report.flagged} flagged overall · {report.sampled} recent conversations sampled. {report.limited?'This is a limited sample. ':''}Includes conversations updated in the last {report.days} days.</p>
   <label>Review topic <select value={topic} onChange={event=>setTopic(event.target.value)}><option value="all">All topics</option>{report.topics.map(t=><option key={t.topic} value={t.topic}>{t.topic} — {t.flagged} flagged / {t.conversations} conversations</option>)}</select></label>
   {cases.length===0?<p>No review flags in this sample. This does not establish that every issue is resolved.</p>:<ul>{cases.map(item=><li key={item.kind+':'+item.id}><strong>{item.topic}</strong> · {item.status.replaceAll('_',' ')}<p>{item.question}</p><p>{item.flags.map(f=>f.label).join(' · ')}</p>{item.lastReply&&<details><summary>Latest Support reply</summary><p>{item.lastReply}</p></details>}<button type="button" onClick={()=>onOpen(item)}>Review conversation</button></li>)}</ul>}
  </>}
 </section>;
}
